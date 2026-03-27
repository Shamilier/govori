/**
 * GovorI — Voximplant INBOUND Script v2.0
 *
 * Architecture:
 *   - OpenAI Realtime API for STT (speech-to-text) + LLM (text generation)
 *   - GovorI Backend for TTS via Cartesia (text-to-speech)
 *   - GovorI Backend for config, logging, and function execution
 *
 * Flow:
 *   1. Call comes in → load config from backend
 *   2. Connect to OpenAI Realtime in TEXT-ONLY output mode
 *   3. OpenAI transcribes user speech (STT) and generates text response (LLM)
 *   4. On ResponseOutputItemDone (type=message) → send text to backend /synthesize
 *   5. Backend calls Cartesia → returns audio URL
 *   6. Script plays audio via call.startPlayback()
 *   7. Repeat until call ends
 *
 * IMPORTANT: Voximplant SDK does NOT have ResponseTextDone event.
 * We use ResponseOutputItemDone for BOTH text messages and function calls.
 */

require(Modules.OpenAI);

// ============================================================
// CONFIGURATION — change these for your deployment
// ============================================================
// Example for local dev with tunnel:
// const BACKEND_BASE_URL = "https://<your-tunnel-domain>";
const BACKEND_BASE_URL = "https://api.disciplaner.com";
const WEBHOOK_SECRET = "";

// Fallback assistant id for legacy mode when destination number is unavailable.
const FALLBACK_ASSISTANT_ID = "default";

// Derived URLs
const TTS_URL = BACKEND_BASE_URL + "/api/voximplant/synthesize";
const FUNCTIONS_URL = BACKEND_BASE_URL + "/api/voximplant/functions/execute";
const LOG_URL = BACKEND_BASE_URL + "/api/voximplant/log";

function normalizePhone(value) {
    if (!value || typeof value !== "string") {
        return null;
    }

    var cleaned = value
        .replace(/^INBOUND:\s*/i, "")
        .replace(/[^\d+]/g, "")
        .trim();

    return cleaned.length > 0 ? cleaned : null;
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

// ============================================================
// MAIN HANDLER
// ============================================================
VoxEngine.addEventListener(AppEvents.CallAlerting, async (event) => {
    const call = event.call;
    let realtimeClient = undefined;
    let isTerminating = false;
    const chatId = "vox_" + Math.random().toString(36).substring(2, 15);
    const callerNumber = call.callerid() || "unknown";
    const destinationNumber = resolveDestinationNumber(event, call);
    const assistantId = destinationNumber || FALLBACK_ASSISTANT_ID;
    const configUrl =
        BACKEND_BASE_URL +
        "/api/voximplant/assistants/config/" +
        encodeURIComponent(assistantId);
    const callId = call.id();

    Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    Logger.write("📞 INBOUND CALL — GovorI v2.0 + Cartesia TTS");
    Logger.write("   Caller: " + callerNumber + ", Call ID: " + callId);
    Logger.write("   Destination: " + (destinationNumber || "unknown"));
    Logger.write("   Assistant ID: " + assistantId);
    Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Conversation state
    let lastUserMessage = "";
    let lastAssistantMessage = "";
    let lastFunctionResult = null;
    let conversationPairCount = 0;
    let isPlayingAudio = false;

    call.answer();

    // --------------------------------------------------------
    // CALL END HANDLER
    // --------------------------------------------------------
    const onCallEnd = () => {
        if (isTerminating) return;
        isTerminating = true;

        Logger.write("📴 Call ending — Caller: " + callerNumber);

        if (realtimeClient) {
            try { realtimeClient.close(); } catch (e) { /* ignore */ }
        }

        if (lastUserMessage || lastAssistantMessage) {
            sendConversationLog();
        }

        sendLogToBackend({
            type: "call_ended",
            data: {
                total_pairs: conversationPairCount,
                ended_by: "disconnected"
            }
        });

        Logger.write("✅ Call terminated — Total pairs: " + conversationPairCount);
        VoxEngine.terminate();
    };

    call.addEventListener(CallEvents.Disconnected, onCallEnd);
    call.addEventListener(CallEvents.Failed, onCallEnd);
    call.addEventListener(CallEvents.PlaybackFinished, () => {
        isPlayingAudio = false;
        Logger.write("🔊 Playback finished");
    });

    // --------------------------------------------------------
    // HELPERS
    // --------------------------------------------------------
    function buildHeaders() {
        const headers = ["Content-Type: application/json"];
        if (WEBHOOK_SECRET) {
            headers.push("x-webhook-secret: " + WEBHOOK_SECRET);
        }
        return headers;
    }

    async function sendLogToBackend(extra) {
        try {
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
                    data: extra.data || {}
                })
            });
        } catch (error) {
            Logger.write("❌ Log error: " + error);
        }
    }

    async function sendConversationLog() {
        if (!lastUserMessage && !lastAssistantMessage) return;

        conversationPairCount++;
        Logger.write("📤 LOG #" + conversationPairCount +
            " | User: \"" + (lastUserMessage || "").substring(0, 60) + "\"" +
            " | AI: \"" + (lastAssistantMessage || "").substring(0, 60) + "\"");

        await sendLogToBackend({
            type: "conversation",
            data: {
                user_message: lastUserMessage,
                assistant_message: lastAssistantMessage,
                function_result: lastFunctionResult
            }
        });

        lastUserMessage = "";
        lastAssistantMessage = "";
        lastFunctionResult = null;
    }

    async function synthesizeAndPlay(text) {
        if (!text || text.trim().length === 0) return;

        Logger.write("🎤 TTS: \"" + text.substring(0, 80) + "\"");
        const started = Date.now();

        try {
            const response = await Net.httpRequestAsync(TTS_URL, {
                headers: buildHeaders(),
                method: "POST",
                postData: JSON.stringify({
                    text: text,
                    assistant_id: assistantId
                })
            });

            if (response.code !== 200) {
                Logger.write("❌ TTS failed: HTTP " + response.code + " " + response.text);
                return;
            }

            const result = JSON.parse(response.text);
            const elapsed = Date.now() - started;
            Logger.write("✅ TTS ready in " + elapsed + "ms — playing " + result.audio_url);

            isPlayingAudio = true;
            call.startPlayback(result.audio_url);

        } catch (error) {
            Logger.write("❌ TTS error: " + error);
        }
    }

    async function terminateCall(reason, farewellText) {
        if (isTerminating) return;

        Logger.write("📴 Terminating: " + reason);

        lastFunctionResult = {
            action: "call_terminated",
            reason: reason,
            timestamp: new Date().toISOString()
        };

        if (farewellText && farewellText.trim().length > 0) {
            await synthesizeAndPlay(farewellText);
            setTimeout(() => {
                if (lastUserMessage || lastAssistantMessage) {
                    sendConversationLog();
                }
                call.hangup();
            }, 4000);
        } else {
            if (lastUserMessage || lastAssistantMessage) {
                sendConversationLog();
            }
            call.hangup();
        }
    }

    // --------------------------------------------------------
    // MAIN LOGIC
    // --------------------------------------------------------
    try {
        // 1. Load config from backend
        Logger.write("🔄 Loading config from backend...");
        const configResponse = await Net.httpRequestAsync(configUrl, {
            headers: buildHeaders(),
            method: "GET"
        });

        if (configResponse.code !== 200) {
            Logger.write("❌ Config failed: HTTP " + configResponse.code + " — " + configResponse.text);
            VoxEngine.terminate();
            return;
        }

        const config = JSON.parse(configResponse.text);
        Logger.write("✅ Config loaded: " + config.assistant_name);

        // Notify backend that call started
        sendLogToBackend({
            type: "call_started",
            data: { agent_name: config.assistant_name }
        });

        // 2. Build function list for OpenAI
        var openaiTools = [];
        var functionNameToIdMap = {};

        if (config.functions && Array.isArray(config.functions)) {
            openaiTools = config.functions.map(function(tool, index) {
                if (tool.type === "function" && tool.function) {
                    var fId = (index + 1).toString();
                    functionNameToIdMap[tool.function.name] = fId;
                    Logger.write("🔧 Function: " + tool.function.name + " → ID " + fId);
                    return {
                        type: "function",
                        name: tool.function.name,
                        description: tool.function.description,
                        parameters: tool.function.parameters
                    };
                }
                return tool;
            });
        }

        // 3. Connect to OpenAI Realtime API
        Logger.write("🔌 Connecting to OpenAI Realtime API (text output mode)...");
        realtimeClient = await OpenAI.createRealtimeAPIClient({
            apiKey: config.api_key,
            model: config.model,
            type: OpenAI.RealtimeAPIClientType.REALTIME,
            onWebSocketClose: function() {
                Logger.write("🔌 OpenAI WebSocket closed");
                if (!isTerminating) {
                    onCallEnd();
                }
            }
        });

        Logger.write("✅ OpenAI connected, model: " + config.model);

        // 4. Configure session — TEXT-ONLY output
        realtimeClient.sessionUpdate({
            session: {
                type: "realtime",
                modalities: ["text"],
                instructions: config.prompt,
                input_audio_transcription: {
                    model: "gpt-4o-transcribe",
                    language: config.language || "ru"
                },
                tools: openaiTools,
                tool_choice: "auto"
            }
        });
        Logger.write("✅ Session configured — type: realtime, modalities: [text]");

        // 5. Send caller audio to OpenAI for STT (one-way)
        realtimeClient.sendMediaTo(call);
        Logger.write("🎙️ Caller audio → OpenAI STT");

        // 6. Play greeting via Cartesia
        if (config.hello) {
            Logger.write("👋 Playing greeting via Cartesia...");
            await synthesizeAndPlay(config.hello);
        }

        // Tell OpenAI about the greeting so it has conversation context
        if (config.hello) {
            realtimeClient.conversationItemCreate({
                item: {
                    type: "message",
                    role: "assistant",
                    content: [{
                        type: "output_text",
                        text: config.hello
                    }]
                }
            });
        }

        // ====================================================
        // EVENT HANDLERS
        // ====================================================

        // 🎤 USER TRANSCRIPTION (OpenAI STT)
        realtimeClient.addEventListener(
            OpenAI.RealtimeAPIEvents.ConversationItemInputAudioTranscriptionCompleted,
            function(event) {
                try {
                    var transcript = event.data && event.data.payload && event.data.payload.transcript;
                    if (!transcript) return;

                    Logger.write("👤 User: \"" + transcript + "\"");
                    lastUserMessage = transcript;
                } catch (error) {
                    Logger.write("❌ STT handler error: " + error);
                }
            }
        );
        Logger.write("✅ Handler: User transcription");

        // 🤖 ASSISTANT TEXT RESPONSE + 🔧 FUNCTION CALLS
        // Both handled via ResponseOutputItemDone since Voximplant SDK
        // does NOT have ResponseTextDone event
        realtimeClient.addEventListener(
            OpenAI.RealtimeAPIEvents.ResponseOutputItemDone,
            async function(event) {
                try {
                    var payload = event.data && event.data.payload;
                    var item = payload && payload.item;
                    if (!item) return;

                    // ---- TEXT MESSAGE (assistant response) ----
                    if (item.type === "message" && item.role === "assistant") {
                        var textContent = "";
                        if (item.content && Array.isArray(item.content)) {
                            for (var i = 0; i < item.content.length; i++) {
                                if (item.content[i].type === "text" && item.content[i].text) {
                                    textContent += item.content[i].text;
                                }
                            }
                        }

                        if (!textContent) return;

                        Logger.write("🤖 Assistant: \"" + textContent.substring(0, 100) + "\"");
                        lastAssistantMessage = textContent;

                        // Synthesize via Cartesia and play
                        await synthesizeAndPlay(textContent);

                        // Log conversation pair
                        if (lastUserMessage && lastAssistantMessage) {
                            await sendConversationLog();
                        }
                        return;
                    }

                    // ---- FUNCTION CALL ----
                    if (item.type === "function_call") {
                        var functionName = item.name;
                        var argumentsStr = item.arguments;
                        var functionCallId = item.call_id;

                        if (!functionName || !argumentsStr) return;

                        Logger.write("🔧 Function: " + functionName + " — " + argumentsStr);

                        var args = JSON.parse(argumentsStr);

                        // HANGUP — handle locally
                        if (functionName === "hangup_call") {
                            realtimeClient.conversationItemCreate({
                                item: {
                                    type: "function_call_output",
                                    call_id: functionCallId,
                                    output: JSON.stringify({ status: "terminating" })
                                }
                            });

                            await terminateCall(
                                args.reason || "agent_decision",
                                args.farewell_message || config.goodbye_text || ""
                            );
                            return;
                        }

                        // ALL OTHER FUNCTIONS — send to backend
                        var fId = functionNameToIdMap[functionName];
                        if (!fId) {
                            Logger.write("❌ Unknown function: " + functionName);
                            realtimeClient.conversationItemCreate({
                                item: {
                                    type: "function_call_output",
                                    call_id: functionCallId,
                                    output: JSON.stringify({ error: "Unknown function: " + functionName })
                                }
                            });
                            realtimeClient.responseCreate();
                            return;
                        }

                        var funcResponse = await Net.httpRequestAsync(FUNCTIONS_URL, {
                            headers: buildHeaders(),
                            method: "POST",
                            postData: JSON.stringify({
                                function_id: fId,
                                arguments: args,
                                call_data: {
                                    call_id: callId,
                                    chat_id: chatId,
                                    assistant_id: assistantId,
                                    caller_number: callerNumber,
                                    destination_number: destinationNumber || undefined
                                }
                            })
                        });

                        var funcResult;
                        if (funcResponse.code === 200) {
                            funcResult = JSON.parse(funcResponse.text);
                            Logger.write("✅ Function result: " + JSON.stringify(funcResult).substring(0, 150));
                        } else {
                            funcResult = { error: "Function failed: HTTP " + funcResponse.code };
                            Logger.write("❌ Function failed: HTTP " + funcResponse.code);
                        }

                        lastFunctionResult = funcResult;

                        realtimeClient.conversationItemCreate({
                            item: {
                                type: "function_call_output",
                                call_id: functionCallId,
                                output: JSON.stringify(funcResult)
                            }
                        });
                        realtimeClient.responseCreate();
                    }

                } catch (error) {
                    Logger.write("❌ OutputItemDone handler error: " + error);
                    if (error.stack) Logger.write("   Stack: " + error.stack);
                }
            }
        );
        Logger.write("✅ Handler: ResponseOutputItemDone (text + functions)");

        // 🔇 INTERRUPTION — user starts speaking while audio plays
        realtimeClient.addEventListener(
            OpenAI.RealtimeAPIEvents.InputAudioBufferSpeechStarted,
            function() {
                try {
                    Logger.write("🔇 Interruption detected");
                    if (isPlayingAudio) {
                        call.stopPlayback();
                        isPlayingAudio = false;
                    }
                    if (realtimeClient) {
                        realtimeClient.clearMediaBuffer();
                    }
                } catch (error) {
                    Logger.write("❌ Interruption error: " + error);
                }
            }
        );
        Logger.write("✅ Handler: Interruption");

        Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        Logger.write("🎉 READY — GovorI v2.0 + Cartesia TTS");
        Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    } catch (error) {
        Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        Logger.write("❌ CRITICAL ERROR: " + error);
        if (error.stack) Logger.write("   Stack: " + error.stack);
        Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        VoxEngine.terminate();
    }
});
