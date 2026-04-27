/**
 * GovorI — Voximplant INBOUND Script v3.0 (Gemini Live)
 *
 * Architecture:
 *   - Gemini Live API for STT + LLM + realtime voice response
 *   - GovorI Backend for assistant config, call logs, function execution
 */

require(Modules.Gemini);

// ============================================================
// CONFIGURATION — keep URLs aligned with your deployed backend
// ============================================================
const BACKEND_BASE_URL = "https://api.disciplaner.online";
const WEBHOOK_SECRET = "";
const FALLBACK_ASSISTANT_ID = "default";

const LOG_URL = BACKEND_BASE_URL + "/api/voximplant/log";
const FUNCTIONS_URL = BACKEND_BASE_URL + "/api/voximplant/functions/execute";

const DEFAULT_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";
const DEFAULT_VOICE = "Kore";
const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizePhone(value) {
    if (!value || typeof value !== "string") {
        return null;
    }

    var cleaned = value
        .replace(/^INBOUND:\s*/i, "")
        .replace(/[^\d+]/g, "")
        .trim();

    if (!cleaned) {
        return null;
    }

    if (cleaned.charAt(0) === "+") {
        return cleaned;
    }

    if (cleaned.indexOf("00") === 0 && cleaned.length > 2) {
        return "+" + cleaned.substring(2);
    }

    if (/^\d+$/.test(cleaned)) {
        // Common RU local trunk format: 8XXXXXXXXXX -> +7XXXXXXXXXX
        if (cleaned.length === 11 && cleaned.charAt(0) === "8") {
            return "+7" + cleaned.substring(1);
        }
        return "+" + cleaned;
    }

    return null;
}

function toFiniteNumber(value, fallback) {
    if (typeof value === "number" && isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim().length > 0) {
        var parsed = Number(value);
        if (isFinite(parsed)) {
            return parsed;
        }
    }

    return fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function readCallMethod(call, methodName) {
    try {
        if (call && typeof call[methodName] === "function") {
            return call[methodName]();
        }
    } catch (error) {
        Logger.write("⚠️ Failed to read call." + methodName + ": " + error);
    }

    return null;
}

function resolveDestinationNumber(event, call) {
    var candidates = [
        event && event.destination_number,
        event && event.destinationNumber,
        event && event.called_number,
        event && event.calledNumber,
        event && event.did,
        event && event.number,
        event && event.to,
        readCallMethod(call, "calledid"),
        readCallMethod(call, "destination"),
        readCallMethod(call, "did"),
        readCallMethod(call, "number"),
        readCallMethod(call, "to"),
    ];

    for (var i = 0; i < candidates.length; i++) {
        var normalized = normalizePhone(candidates[i]);
        if (normalized) {
            return normalized;
        }
    }

    return null;
}

function safeJsonParse(value, fallback) {
    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}

function buildHeaders() {
    var headers = ["Content-Type: application/json"];
    if (WEBHOOK_SECRET) {
        headers.push("x-webhook-secret: " + WEBHOOK_SECRET);
    }
    return headers;
}

function mapFunctionsToGeminiTools(functionsList, functionNameToIdMap) {
    if (!functionsList || !Array.isArray(functionsList)) {
        return [];
    }

    var declarations = [];

    for (var i = 0; i < functionsList.length; i++) {
        var tool = functionsList[i];
        if (!tool || tool.type !== "function" || !tool.function) {
            continue;
        }

        var fn = tool.function;
        if (!fn.name) {
            continue;
        }

        var functionId = (i + 1).toString();
        functionNameToIdMap[fn.name] = functionId;

        declarations.push({
            name: fn.name,
            description: fn.description || "",
            parametersJsonSchema: fn.parameters || {
                type: "object",
                properties: {},
                required: [],
            },
        });
    }

    if (!declarations.length) {
        return [];
    }

    return [{ functionDeclarations: declarations }];
}

function buildRuntimeInstructions(basePrompt) {
    var prompt = (basePrompt || "Ты голосовой AI-агент.").trim();
    return (
        prompt +
        "\n\nТелефонный формат: отвечай коротко (1-2 предложения), без длинных вступлений и списков."
    );
}

function resolveGeminiModel(config) {
    var raw = String(config.model || config.chat_model || "").trim();

    if (!raw) {
        return DEFAULT_MODEL;
    }

    // Gemini Live connector requires live/bidi-capable models.
    if (/live|bidi|native-audio/i.test(raw)) {
        return raw;
    }

    // User requirement: stay on Gemini 2.5 Flash (Live API variant).
    if (/^gemini-3(\.|-)/i.test(raw)) {
        return DEFAULT_MODEL;
    }

    // Common non-live values from legacy config that break WebSocket with 1008.
    if (/^gemini-2\.5-flash$/i.test(raw)) {
        return DEFAULT_MODEL;
    }

    if (/^gemini-2\.5-flash-preview/i.test(raw)) {
        return DEFAULT_MODEL;
    }

    if (/^gemini-1\.5/i.test(raw)) {
        return DEFAULT_MODEL;
    }

    return DEFAULT_MODEL;
}

function resolveGeminiVoice(config) {
    var raw =
        config &&
        config.voice_config &&
        typeof config.voice_config.voice_id === "string"
            ? config.voice_config.voice_id.trim()
            : "";

    if (!raw) {
        return DEFAULT_VOICE;
    }

    // Old Cartesia voice IDs may leak from backend config; Gemini expects prebuilt names.
    if (UUID_RE.test(raw)) {
        return DEFAULT_VOICE;
    }

    return raw;
}

// ============================================================
// MAIN HANDLER
// ============================================================
VoxEngine.addEventListener(AppEvents.CallAlerting, async function(event) {
    var call = event.call;
    var geminiClient = undefined;
    var isTerminating = false;
    var hangupScheduled = false;

    var chatId = "vox_" + Math.random().toString(36).substring(2, 15);
    var callerNumber = call.callerid() || "unknown";
    var destinationNumber = resolveDestinationNumber(event, call);
    var assistantId = destinationNumber || FALLBACK_ASSISTANT_ID;
    var configUrl =
        BACKEND_BASE_URL +
        "/api/voximplant/assistants/config/" +
        encodeURIComponent(assistantId);
    var callId = call.id();

    // Conversation state
    var lastUserMessage = "";
    var lastAssistantMessage = "";
    var lastFunctionResult = null;
    var conversationPairCount = 0;
    var recordingUrl = "";

    function scheduleHangup(delayMs) {
        if (hangupScheduled) {
            return;
        }

        hangupScheduled = true;
        var hangupDelayMs = clamp(Math.round(delayMs || 3000), 900, 7000);

        setTimeout(function() {
            if (lastUserMessage || lastAssistantMessage) {
                sendConversationLog();
            }
            call.hangup();
        }, hangupDelayMs);
    }

    function startCallRecording() {
        try {
            if (!call || typeof call.record !== "function") {
                return;
            }

            call.addEventListener(CallEvents.RecordStarted, function(event) {
                recordingUrl = event && event.url ? String(event.url) : "";
                if (recordingUrl) {
                    sendLogToBackend({
                        type: "recording_started",
                        data: {
                            recording_url: recordingUrl,
                        },
                    });
                }
            });

            call.record({ stereo: true });
        } catch (error) {
            Logger.write("⚠️ Recording start failed: " + error);
        }
    }

    async function sendLogToBackend(extra) {
        try {
            var data = extra.data || {};
            if (recordingUrl && !data.recording_url) {
                data.recording_url = recordingUrl;
            }

            await Net.httpRequestAsync(LOG_URL, {
                headers: buildHeaders(),
                method: "POST",
                postData: JSON.stringify({
                    assistant_id: assistantId,
                    chat_id: chatId,
                    call_id: callId,
                    caller_number: callerNumber,
                    destination_number: destinationNumber || undefined,
                    type: extra.type || "conversation",
                    data: data,
                }),
            });
        } catch (error) {
            Logger.write("❌ Log error: " + error);
        }
    }

    async function sendConversationLog() {
        if (!lastUserMessage && !lastAssistantMessage) {
            return;
        }

        conversationPairCount++;
        Logger.write(
            "📤 LOG #" +
                conversationPairCount +
                " | User: \"" +
                (lastUserMessage || "").substring(0, 60) +
                "\" | AI: \"" +
                (lastAssistantMessage || "").substring(0, 60) +
                "\""
        );

        await sendLogToBackend({
            type: "conversation",
            data: {
                user_message: lastUserMessage,
                assistant_message: lastAssistantMessage,
                function_result: lastFunctionResult,
            },
        });

        lastUserMessage = "";
        lastAssistantMessage = "";
        lastFunctionResult = null;
    }

    function onCallEnd() {
        if (isTerminating) {
            return;
        }
        isTerminating = true;

        Logger.write("📴 Call ending — Caller: " + callerNumber);

        if (geminiClient) {
            try {
                geminiClient.close();
            } catch (e) {
                // ignore close errors
            }
        }

        if (lastUserMessage || lastAssistantMessage) {
            sendConversationLog();
        }

        sendLogToBackend({
            type: "call_ended",
            data: {
                total_pairs: conversationPairCount,
                ended_by: "disconnected",
            },
        });

        Logger.write("✅ Call terminated — Total pairs: " + conversationPairCount);
        VoxEngine.terminate();
    }

    call.addEventListener(CallEvents.Disconnected, onCallEnd);
    call.addEventListener(CallEvents.Failed, onCallEnd);

    call.answer();
    startCallRecording();

    Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    Logger.write("📞 INBOUND CALL — GovorI v3.0 + Gemini Live");
    Logger.write("   Caller: " + callerNumber + ", Call ID: " + callId);
    Logger.write("   Destination: " + (destinationNumber || "unknown"));
    Logger.write("   Assistant ID: " + assistantId);
    Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    try {
        // 1. Load config from backend
        Logger.write("🔄 Loading config from backend...");
        var configResponse = await Net.httpRequestAsync(configUrl, {
            headers: buildHeaders(),
            method: "GET",
        });

        if (configResponse.code !== 200) {
            Logger.write(
                "❌ Config failed: HTTP " +
                    configResponse.code +
                    " — " +
                    configResponse.text
            );
            VoxEngine.terminate();
            return;
        }

        var config = safeJsonParse(configResponse.text, {});
        Logger.write("✅ Config loaded: " + (config.assistant_name || "unknown"));

        sendLogToBackend({
            type: "call_started",
            data: {
                agent_name: config.assistant_name,
            },
        });

        // 2. Build Gemini tools map from backend function list
        var functionNameToIdMap = {};
        var geminiTools = mapFunctionsToGeminiTools(
            config.functions,
            functionNameToIdMap
        );

        // 3. Build Gemini session config
        var agentSettings = config.agent_settings || {};
        var responseMaxTokens = clamp(
            Math.round(toFiniteNumber(agentSettings.response_max_tokens, 80)),
            32,
            1024
        );
        var responseTemperature = clamp(
            toFiniteNumber(agentSettings.response_temperature, 0.2),
            0,
            1.2
        );

        var model = resolveGeminiModel(config);
        var voiceName = resolveGeminiVoice(config);
        var backendModelRaw = String(config.model || config.chat_model || "").trim();
        var backendVoiceRaw =
            config &&
            config.voice_config &&
            typeof config.voice_config.voice_id === "string"
                ? config.voice_config.voice_id.trim()
                : "";

        if (backendModelRaw && backendModelRaw !== model) {
            Logger.write(
                "⚠️ Backend model \"" +
                    backendModelRaw +
                    "\" is not Gemini Live compatible. Using \"" +
                    model +
                    "\"."
            );
        }
        if (backendVoiceRaw && backendVoiceRaw !== voiceName) {
            Logger.write(
                "⚠️ Backend voice \"" +
                    backendVoiceRaw +
                    "\" looks non-Gemini. Using \"" +
                    voiceName +
                    "\"."
            );
        }

        var connectConfig = {
            responseModalities: ["AUDIO"],
            thinkingConfig: { thinkingLevel: "minimal" },
            generationConfig: {
                temperature: responseTemperature,
                maxOutputTokens: responseMaxTokens,
            },
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: voiceName,
                    },
                },
            },
            systemInstruction: {
                parts: [{ text: buildRuntimeInstructions(config.prompt) }],
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
        };

        if (geminiTools.length) {
            connectConfig.tools = geminiTools;
        }

        // 4. Connect to Gemini Live
        Logger.write("🔌 Connecting to Gemini Live API...");
        geminiClient = await Gemini.createLiveAPIClient({
            apiKey: config.api_key,
            model: model,
            backend: Gemini.Backend.GEMINI_API,
            connectConfig: connectConfig,
            onWebSocketClose: function() {
                Logger.write("🔌 Gemini WebSocket closed");
                if (!isTerminating) {
                    onCallEnd();
                }
            },
        });

        Logger.write("✅ Gemini connected, model: " + model + ", voice: " + voiceName);

        // 5. Wait for setup complete, then bridge call audio
        geminiClient.addEventListener(Gemini.LiveAPIEvents.SetupComplete, function() {
            Logger.write("✅ Gemini setup complete — bridging audio");
            VoxEngine.sendMediaBetween(call, geminiClient);

            if (config.hello && String(config.hello).trim().length > 0) {
                geminiClient.sendRealtimeInput({
                    text:
                        "Поздоровайся с абонентом дословно так: \"" +
                        String(config.hello).trim() +
                        "\".",
                });
            }
        });

        // 6. User/assistant transcripts + barge-in
        geminiClient.addEventListener(
            Gemini.LiveAPIEvents.ServerContent,
            function(eventData) {
                try {
                    var payload =
                        eventData && eventData.data && eventData.data.payload
                            ? eventData.data.payload
                            : {};

                    var userText =
                        payload.inputTranscription && payload.inputTranscription.text
                            ? String(payload.inputTranscription.text).trim()
                            : "";
                    if (userText && userText !== lastUserMessage) {
                        lastUserMessage = userText;
                        Logger.write("👤 User: \"" + userText.substring(0, 120) + "\"");
                    }

                    var assistantText =
                        payload.outputTranscription && payload.outputTranscription.text
                            ? String(payload.outputTranscription.text).trim()
                            : "";
                    if (assistantText && assistantText !== lastAssistantMessage) {
                        lastAssistantMessage = assistantText;
                        Logger.write(
                            "🤖 Assistant: \"" +
                                assistantText.substring(0, 120) +
                                "\""
                        );

                        if (lastUserMessage && lastAssistantMessage) {
                            sendConversationLog();
                        }
                    }

                    if (payload.interrupted) {
                        Logger.write("🔇 Interruption detected");
                        geminiClient.clearMediaBuffer();
                    }
                } catch (error) {
                    Logger.write("❌ ServerContent handler error: " + error);
                }
            }
        );

        // 7. Function calls from Gemini -> backend
        geminiClient.addEventListener(Gemini.LiveAPIEvents.ToolCall, async function(eventData) {
            try {
                var payload =
                    eventData && eventData.data && eventData.data.payload
                        ? eventData.data.payload
                        : {};
                var functionCalls =
                    payload && Array.isArray(payload.functionCalls)
                        ? payload.functionCalls
                        : [];

                if (!functionCalls.length) {
                    return;
                }

                var responses = [];
                var shouldHangup = false;

                for (var i = 0; i < functionCalls.length; i++) {
                    var fn = functionCalls[i] || {};
                    var fnId = fn.id;
                    var fnName = fn.name;
                    var fnArgs = fn.args || {};

                    if (!fnId || !fnName) {
                        continue;
                    }

                    Logger.write("🔧 Function: " + fnName + " — " + JSON.stringify(fnArgs));

                    if (fnName === "hangup_call") {
                        shouldHangup = true;
                        var reason = fnArgs.reason || "agent_decision";

                        lastFunctionResult = {
                            action: "call_terminated",
                            reason: reason,
                            timestamp: new Date().toISOString(),
                        };

                        responses.push({
                            id: fnId,
                            name: fnName,
                            response: {
                                output: {
                                    status: "terminating",
                                    reason: reason,
                                },
                            },
                        });

                        continue;
                    }

                    var backendFunctionId = functionNameToIdMap[fnName];
                    if (!backendFunctionId) {
                        responses.push({
                            id: fnId,
                            name: fnName,
                            response: {
                                error: "Unknown function: " + fnName,
                            },
                        });
                        continue;
                    }

                    var funcHttp = await Net.httpRequestAsync(FUNCTIONS_URL, {
                        headers: buildHeaders(),
                        method: "POST",
                        postData: JSON.stringify({
                            function_id: backendFunctionId,
                            arguments: fnArgs,
                            call_data: {
                                call_id: callId,
                                chat_id: chatId,
                                assistant_id: assistantId,
                                caller_number: callerNumber,
                                destination_number: destinationNumber || undefined,
                            },
                        }),
                    });

                    var funcResult;
                    if (funcHttp.code === 200) {
                        funcResult = safeJsonParse(funcHttp.text, { raw: funcHttp.text });
                        Logger.write(
                            "✅ Function result: " +
                                JSON.stringify(funcResult).substring(0, 150)
                        );
                    } else {
                        funcResult = {
                            error: "Function failed: HTTP " + funcHttp.code,
                            body: funcHttp.text,
                        };
                        Logger.write("❌ Function failed: HTTP " + funcHttp.code);
                    }

                    lastFunctionResult = funcResult;

                    responses.push({
                        id: fnId,
                        name: fnName,
                        response: {
                            output: funcResult,
                        },
                    });
                }

                if (responses.length) {
                    geminiClient.sendToolResponse({
                        functionResponses: responses,
                    });
                }

                if (shouldHangup) {
                    scheduleHangup(3200);
                }
            } catch (error) {
                Logger.write("❌ ToolCall handler error: " + error);
            }
        });

        geminiClient.addEventListener(
            Gemini.LiveAPIEvents.ToolCallCancellation,
            function(eventData) {
                Logger.write("⚠️ ToolCallCancellation: " + JSON.stringify(eventData.data || {}));
            }
        );

        Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        Logger.write("🎉 READY — GovorI v3.0 + Gemini Live");
        Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    } catch (error) {
        Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        Logger.write("❌ CRITICAL ERROR: " + error);
        if (error && error.stack) {
            Logger.write("   Stack: " + error.stack);
        }
        Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        if (geminiClient) {
            try {
                geminiClient.close();
            } catch (closeError) {
                // ignore close errors
            }
        }

        VoxEngine.terminate();
    }
});
