/**
 * GovorI — Voximplant OUTBOUND Script v1.0 (Gemini Live)
 *
 * Start flow:
 *   1) Scenario is started via Voximplant StartScenarios API
 *   2) script_custom_data contains target phone and optional caller id / assistant id
 *   3) Script dials PSTN via callPSTN and, after connect, runs Gemini Live session
 *
 * Required script_custom_data JSON:
 *   {
 *     "to": "+79991112233",
 *     "from": "+79014172705",      // optional
 *     "assistant_id": "+79014172705" // optional
 *   }
 */

require(Modules.Gemini);

const BACKEND_BASE_URL = "https://api.disciplaner.online";
const WEBHOOK_SECRET = "";
const FALLBACK_ASSISTANT_ID = "default";

const LOG_URL = BACKEND_BASE_URL + "/api/voximplant/log";
const FUNCTIONS_URL = BACKEND_BASE_URL + "/api/voximplant/functions/execute";

const DEFAULT_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";
const DEFAULT_TEXT_MODEL = "gemini-3.1-flash-live-preview";
const DEFAULT_VOICE = "Kore";
const FALLBACK_STARTUP_GREETING_TEXT =
    "Здравствуйте! Это Ника из Авито продвижения. Есть минутка?";
const STARTUP_GREETING_MAX_WAIT_MS = 5500;
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

function buildRuntimeInstructions(basePrompt, startupGreetingText) {
    var prompt = (basePrompt || "Ты голосовой AI-агент.").trim();
    var greeting = startupGreetingText || FALLBACK_STARTUP_GREETING_TEXT;
    return (
        prompt +
        "\n\nСтартовая фраза уже произнесена синтезом тем же голосом: \"" +
        greeting +
        "\". Не повторяй приветствие; если абонент ответил, сразу продолжай разговор по сути." +
        "\n\nТелефонный формат: отвечай коротко (1-2 предложения), без длинных вступлений и списков."
    );
}

function isExternalTtsMode(config) {
    var provider =
        config && typeof config.tts_provider === "string"
            ? config.tts_provider.trim().toLowerCase()
            : "";

    if (
        !provider &&
        config &&
        config.voice_config &&
        typeof config.voice_config.provider === "string"
    ) {
        provider = config.voice_config.provider.trim().toLowerCase();
    }

    return provider === "elevenlabs";
}

function resolveStartupGreetingText(config) {
    var text =
        config && typeof config.startup_greeting_text === "string"
            ? config.startup_greeting_text.trim()
            : "";

    if (!text && config && typeof config.hello === "string") {
        text = config.hello.trim();
    }

    return text || FALLBACK_STARTUP_GREETING_TEXT;
}

async function synthesizeStartupGreeting(config, assistantId, startupGreetingText) {
    var requestedVoiceId = "";
    try {
        var endpoint =
            config && typeof config.tts_endpoint === "string"
                ? config.tts_endpoint.trim()
                : "";

        if (!endpoint) {
            endpoint = BACKEND_BASE_URL + "/api/voximplant/synthesize";
        }

        var voiceConfig = (config && config.voice_config) || {};
        requestedVoiceId =
            voiceConfig && typeof voiceConfig.voice_id === "string"
                ? voiceConfig.voice_id.trim()
                : "";
        var response = await Net.httpRequestAsync(endpoint, {
            headers: buildHeaders(),
            method: "POST",
            postData: JSON.stringify({
                assistant_id: assistantId,
                text: startupGreetingText,
                voice_id: requestedVoiceId || undefined,
                speed: toFiniteNumber(voiceConfig.speed, 1),
                language:
                    typeof voiceConfig.language === "string"
                        ? voiceConfig.language
                        : "ru",
            }),
        });

        if (response.code !== 200) {
            Logger.write(
                "⚠️ Startup greeting TTS failed: HTTP " +
                    response.code +
                    " — " +
                    response.text
            );
            return null;
        }

        var result = safeJsonParse(response.text, {});
        if (result && typeof result.audio_url === "string") {
            return {
                audioUrl: result.audio_url,
                durationMs: toFiniteNumber(result.duration_ms, 0),
            };
        }
    } catch (error) {
        Logger.write("⚠️ Startup greeting TTS error: " + error);
    }

    return null;
}

function playStartupGreeting(call, greetingAudio, startupGreetingText, onFinished) {
    var finished = false;
    var maxWaitMs = STARTUP_GREETING_MAX_WAIT_MS;

    function finish() {
        if (finished) {
            return;
        }
        finished = true;
        if (typeof onFinished === "function") {
            onFinished();
        }
    }

    try {
        if (
            greetingAudio &&
            greetingAudio.audioUrl &&
            call &&
            typeof call.startPlayback === "function"
        ) {
            var playbackFinishedEvent =
                typeof CallEvents !== "undefined" ? CallEvents.PlaybackFinished : null;
            var playbackFinishedHandler = function() {
                Logger.write("✅ Startup greeting playback finished");
                if (
                    playbackFinishedEvent &&
                    typeof call.removeEventListener === "function"
                ) {
                    call.removeEventListener(
                        playbackFinishedEvent,
                        playbackFinishedHandler
                    );
                }
                finish();
            };

            if (playbackFinishedEvent && typeof call.addEventListener === "function") {
                call.addEventListener(playbackFinishedEvent, playbackFinishedHandler);
            }

            call.startPlayback(greetingAudio.audioUrl, {
                progressivePlayback: true,
            });
            setTimeout(finish, maxWaitMs);
            return true;
        }

        Logger.write("⚠️ No synthesized startup greeting; Gemini will greet");
    } catch (error) {
        Logger.write("⚠️ Startup greeting failed: " + error);
    }

    finish();
    return false;
}

function resolveGeminiModel(config) {
    if (isExternalTtsMode(config)) {
        return DEFAULT_TEXT_MODEL;
    }

    var raw = String(config.model || config.chat_model || "").trim();

    if (!raw) {
        return DEFAULT_MODEL;
    }

    if (/live|bidi|native-audio/i.test(raw)) {
        return raw;
    }

    if (/^gemini-3(\.|-)/i.test(raw)) {
        return DEFAULT_MODEL;
    }

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
    if (isExternalTtsMode(config)) {
        return "";
    }

    var raw =
        config &&
        config.voice_config &&
        typeof config.voice_config.voice_id === "string"
            ? config.voice_config.voice_id.trim()
            : "";

    if (!raw) {
        return DEFAULT_VOICE;
    }

    if (UUID_RE.test(raw) || raw.charAt(0) === "+") {
        return DEFAULT_VOICE;
    }

    return raw;
}

function extractPayload(eventData) {
    return eventData && eventData.data && eventData.data.payload
        ? eventData.data.payload
        : {};
}

function appendTextChunk(existing, chunk) {
    var next = typeof chunk === "string" ? chunk.trim() : "";
    if (!next) {
        return existing || "";
    }

    var current = existing || "";
    if (!current) {
        return next;
    }

    if (current === next || current.indexOf(next) === current.length - next.length) {
        return current;
    }

    if (next.indexOf(current) === 0) {
        return next;
    }

    return /[.,!?;:)]$/.test(current) || /^[,!?;:)]/.test(next)
        ? current + next
        : current + " " + next;
}

function extractAssistantTextChunk(eventData, payload) {
    var chunks = [];

    if (eventData && typeof eventData.text === "string") {
        chunks.push(eventData.text);
    }

    if (eventData && eventData.data && typeof eventData.data.text === "string") {
        chunks.push(eventData.data.text);
    }

    if (payload && typeof payload.text === "string") {
        chunks.push(payload.text);
    }

    var modelTurn = payload && payload.modelTurn;
    if (modelTurn && Array.isArray(modelTurn.parts)) {
        for (var i = 0; i < modelTurn.parts.length; i++) {
            var part = modelTurn.parts[i];
            if (part && typeof part.text === "string") {
                chunks.push(part.text);
            }
        }
    }

    return chunks.join(" ").trim();
}

function splitReadySegments(buffer, flushRemainder) {
    var source = typeof buffer === "string" ? buffer.trim() : "";
    if (!source) {
        return { segments: [], remainder: "" };
    }

    var segments = [];
    var regex = /(.+?[.!?]+(?:["»”']+)?)(?=\s+|$)/g;
    var cursor = 0;
    var match = null;

    while ((match = regex.exec(source))) {
        var text = match[1].trim();
        if (text) {
            segments.push(text);
        }
        cursor = match.index + match[0].length;
    }

    var remainder = source.slice(cursor).trim();
    if (flushRemainder && remainder) {
        segments.push(remainder);
        remainder = "";
    }

    return {
        segments: segments,
        remainder: remainder,
    };
}

async function runGeminiSession(params) {
    var call = params.call;
    var destinationNumber = params.destinationNumber;
    var callerNumber = params.callerNumber || call.callerid() || "unknown";
    var assistantId = params.assistantId || destinationNumber || FALLBACK_ASSISTANT_ID;
    var configResponsePromise = params.configResponsePromise;
    var callId = call.id();
    var chatId = "vox_" + Math.random().toString(36).substring(2, 15);

    var configUrl =
        BACKEND_BASE_URL +
        "/api/voximplant/assistants/config/" +
        encodeURIComponent(assistantId);

    var geminiClient = undefined;
    var isTerminating = false;
    var hangupScheduled = false;

    var lastUserMessage = "";
    var lastAssistantMessage = "";
    var lastFunctionResult = null;
    var conversationPairCount = 0;
    var recordingUrl = "";
    var startupGreetingPlayed = false;
    var startupGreetingFinished = true;
    var geminiSetupComplete = false;
    var mediaBridged = false;
    var externalTtsEnabled = false;
    var externalPlaybackGeneration = 0;
    var externalPlaybackQueue = [];
    var externalActivePlayer = null;
    var externalAssistantBuffer = "";
    var externalAssistantTurnText = "";

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
                            direction: "outbound",
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

    function stopExternalActivePlayer() {
        if (!externalActivePlayer) {
            return;
        }

        var player = externalActivePlayer;
        externalActivePlayer = null;

        try {
            if (typeof player.stopMediaTo === "function") {
                player.stopMediaTo(call);
            }
        } catch (error) {
            Logger.write("⚠️ Failed to stop player media: " + error);
        }

        try {
            if (typeof player.stop === "function") {
                player.stop();
            }
        } catch (error) {
            Logger.write("⚠️ Failed to stop player: " + error);
        }
    }

    function clearExternalPlayback(reason, logPartial) {
        externalPlaybackGeneration++;
        externalPlaybackQueue = [];
        externalAssistantBuffer = "";
        stopExternalActivePlayer();

        if (logPartial && externalAssistantTurnText.trim()) {
            lastAssistantMessage = externalAssistantTurnText.trim();
            externalAssistantTurnText = "";
            if (lastUserMessage && lastAssistantMessage) {
                sendConversationLog();
            }
        } else if (!logPartial) {
            externalAssistantTurnText = "";
        }

        if (reason) {
            Logger.write("🔇 Cleared external playback: " + reason);
        }
    }

    function playNextExternalSegment() {
        if (externalActivePlayer || !externalPlaybackQueue.length) {
            return;
        }

        var segment = externalPlaybackQueue.shift();
        if (!segment || segment.generation !== externalPlaybackGeneration) {
            playNextExternalSegment();
            return;
        }

        try {
            var player = VoxEngine.createURLPlayer({
                url: segment.audioUrl,
            });
            externalActivePlayer = player;

            var finish = function() {
                if (externalActivePlayer === player) {
                    externalActivePlayer = null;
                }

                try {
                    if (typeof player.stopMediaTo === "function") {
                        player.stopMediaTo(call);
                    }
                } catch (error) {}

                try {
                    player.removeEventListener(PlayerEvents.PlaybackFinished, finish);
                    player.removeEventListener(PlayerEvents.Stopped, finish);
                } catch (error) {}

                playNextExternalSegment();
            };

            player.addEventListener(PlayerEvents.PlaybackFinished, finish);
            player.addEventListener(PlayerEvents.Stopped, finish);
            player.addEventListener(PlayerEvents.Error, function(event) {
                Logger.write(
                    "⚠️ External TTS playback error: " +
                        ((event && event.error) || "unknown")
                );
                finish();
            });

            player.sendMediaTo(call);
        } catch (error) {
            externalActivePlayer = null;
            Logger.write("⚠️ External TTS player failed: " + error);
            playNextExternalSegment();
        }
    }

    function enqueueExternalSegment(config, text) {
        var segmentText = typeof text === "string" ? text.trim() : "";
        if (!segmentText) {
            return;
        }

        externalAssistantTurnText = appendTextChunk(
            externalAssistantTurnText,
            segmentText
        );

        var generation = externalPlaybackGeneration;
        void (async function() {
            var synthesized = await synthesizeStartupGreeting(
                config,
                assistantId,
                segmentText
            );

            if (
                !synthesized ||
                !synthesized.audioUrl ||
                generation !== externalPlaybackGeneration
            ) {
                return;
            }

            externalPlaybackQueue.push({
                audioUrl: synthesized.audioUrl,
                generation: generation,
            });
            playNextExternalSegment();
        })();
    }

    function flushExternalAssistantSegments(config, flushRemainder) {
        var split = splitReadySegments(externalAssistantBuffer, flushRemainder);
        externalAssistantBuffer = split.remainder;

        for (var i = 0; i < split.segments.length; i++) {
            enqueueExternalSegment(config, split.segments[i]);
        }
    }

    function finalizeExternalAssistantTurn(config) {
        flushExternalAssistantSegments(config, true);

        if (externalAssistantTurnText.trim()) {
            lastAssistantMessage = externalAssistantTurnText.trim();
            externalAssistantTurnText = "";
            if (lastUserMessage && lastAssistantMessage) {
                sendConversationLog();
            }
        }
    }

    function maybeBridgeAudio(config) {
        if (mediaBridged || !geminiSetupComplete || !geminiClient) {
            return;
        }

        mediaBridged = true;
        Logger.write("✅ Bridging call audio to Gemini");
        VoxEngine.sendMediaBetween(call, geminiClient);

        if (
            !startupGreetingPlayed &&
            config &&
            config.hello &&
            String(config.hello).trim().length > 0
        ) {
            geminiClient.sendRealtimeInput({
                text:
                    "Поздоровайся с абонентом дословно так: \"" +
                    String(config.hello).trim() +
                    "\".",
            });
        }
    }

    function onCallEnd() {
        if (isTerminating) {
            return;
        }
        isTerminating = true;

        Logger.write("📴 Call ending — Caller: " + callerNumber);
        if (externalTtsEnabled) {
            clearExternalPlayback("call_end", false);
        }

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
                direction: "outbound",
            },
        });

        Logger.write("✅ Call terminated — Total pairs: " + conversationPairCount);
        VoxEngine.terminate();
    }

    call.addEventListener(CallEvents.Disconnected, onCallEnd);
    call.addEventListener(CallEvents.Failed, onCallEnd);

    Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    Logger.write("📞 OUTBOUND CALL — GovorI + Gemini");
    Logger.write("   Caller: " + callerNumber + ", Call ID: " + callId);
    Logger.write("   Destination: " + (destinationNumber || "unknown"));
    Logger.write("   Assistant ID: " + assistantId);
    Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    try {
        startCallRecording();

        Logger.write("🔄 Loading config from backend...");
        var configResponse = configResponsePromise
            ? await configResponsePromise
            : await Net.httpRequestAsync(configUrl, {
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
        externalTtsEnabled = isExternalTtsMode(config);
        var startupGreetingText = resolveStartupGreetingText(config);
        var greetingAudio = params.startupGreetingAudioPromise
            ? await params.startupGreetingAudioPromise
            : await synthesizeStartupGreeting(
                  config,
                  assistantId,
                  startupGreetingText
              );

        startupGreetingFinished = false;
        startupGreetingPlayed = playStartupGreeting(
            call,
            greetingAudio,
            startupGreetingText,
            function() {
                startupGreetingFinished = true;
                maybeBridgeAudio(config);
            }
        );
        if (!startupGreetingPlayed) {
            startupGreetingFinished = true;
        } else {
            sendLogToBackend({
                type: "startup_greeting",
                data: {
                    assistant_message: startupGreetingText,
                    direction: "outbound",
                    synthesized_with_agent_voice: Boolean(
                        greetingAudio && greetingAudio.audioUrl
                    ),
                },
            });
        }

        sendLogToBackend({
            type: "call_started",
            data: {
                direction: "outbound",
                agent_name: config.assistant_name,
            },
        });

        var functionNameToIdMap = {};
        var geminiTools = mapFunctionsToGeminiTools(
            config.functions,
            functionNameToIdMap
        );

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

        var connectConfig = {
            responseModalities: externalTtsEnabled ? ["TEXT"] : ["AUDIO"],
            realtimeInputConfig: {
                automaticActivityDetection: {
                    disabled: false,
                    startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
                    endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
                    prefixPaddingMs: 80,
                    silenceDurationMs: 300,
                },
                activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
                turnCoverage: "TURN_INCLUDES_ONLY_ACTIVITY",
            },
            thinkingConfig: { thinkingLevel: "minimal" },
            generationConfig: {
                temperature: responseTemperature,
                maxOutputTokens: responseMaxTokens,
            },
            systemInstruction: {
                parts: [
                    {
                        text: buildRuntimeInstructions(
                            config.prompt,
                            startupGreetingText
                        ),
                    },
                ],
            },
            inputAudioTranscription: {},
        };

        if (!externalTtsEnabled) {
            connectConfig.speechConfig = {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: voiceName,
                    },
                },
            };
            connectConfig.outputAudioTranscription = {};
        }

        if (geminiTools.length) {
            connectConfig.tools = geminiTools;
        }

        Logger.write(
            externalTtsEnabled
                ? "🔌 Connecting to Gemini Live API (text mode + ElevenLabs)..."
                : "🔌 Connecting to Gemini Live API..."
        );
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

        Logger.write(
            "✅ Gemini connected, model: " +
                model +
                (externalTtsEnabled ? ", mode: text" : ", voice: " + voiceName)
        );

        geminiClient.addEventListener(Gemini.LiveAPIEvents.SetupComplete, function() {
            Logger.write("✅ Gemini setup complete");
            geminiSetupComplete = true;
            maybeBridgeAudio(config);
        });

        geminiClient.addEventListener(
            Gemini.LiveAPIEvents.ServerContent,
            function(eventData) {
                try {
                    var payload = extractPayload(eventData);

                    var userText =
                        payload.inputTranscription && payload.inputTranscription.text
                            ? String(payload.inputTranscription.text).trim()
                            : "";
                    if (userText && userText !== lastUserMessage) {
                        lastUserMessage = userText;
                        Logger.write("👤 User: \"" + userText.substring(0, 120) + "\"");
                    }

                    if (externalTtsEnabled) {
                        var assistantTextChunk = extractAssistantTextChunk(
                            eventData,
                            payload
                        );
                        if (assistantTextChunk) {
                            externalAssistantBuffer = appendTextChunk(
                                externalAssistantBuffer,
                                assistantTextChunk
                            );
                            Logger.write(
                                "🤖 Assistant chunk: \"" +
                                    assistantTextChunk.substring(0, 120) +
                                    "\""
                            );
                            flushExternalAssistantSegments(config, false);
                        }
                    } else {
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
                    }

                    if (payload.interrupted) {
                        Logger.write("🔇 Interruption detected");
                        if (externalTtsEnabled) {
                            clearExternalPlayback("interrupted", true);
                        } else {
                            geminiClient.clearMediaBuffer();
                        }
                    }

                    if (externalTtsEnabled && payload.turnComplete) {
                        finalizeExternalAssistantTurn(config);
                    }
                } catch (error) {
                    Logger.write("❌ ServerContent handler error: " + error);
                }
            }
        );

        geminiClient.addEventListener(
            Gemini.LiveAPIEvents.ToolCall,
            async function(eventData) {
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
            }
        );

        geminiClient.addEventListener(
            Gemini.LiveAPIEvents.ToolCallCancellation,
            function(eventData) {
                Logger.write("⚠️ ToolCallCancellation: " + JSON.stringify(eventData.data || {}));
            }
        );

        Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        Logger.write(
            externalTtsEnabled
                ? "🎉 READY — GovorI OUTBOUND + Gemini Text + ElevenLabs"
                : "🎉 READY — GovorI OUTBOUND + Gemini Live"
        );
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
}

VoxEngine.addEventListener(AppEvents.Started, function() {
    var raw = VoxEngine.customData ? VoxEngine.customData() : "";
    var data = safeJsonParse(raw || "{}", {});

    var to = normalizePhone(
        (typeof data.to === "string" && data.to) ||
            (typeof data.destination_number === "string" && data.destination_number) ||
            (typeof data.callee_phone === "string" && data.callee_phone) ||
            ""
    );

    var from = normalizePhone(
        (typeof data.from === "string" && data.from) ||
            (typeof data.caller_id === "string" && data.caller_id) ||
            (typeof data.source === "string" && data.source) ||
            ""
    );

    var assistantId =
        typeof data.assistant_id === "string" && data.assistant_id.trim().length > 0
            ? data.assistant_id.trim()
            : from || FALLBACK_ASSISTANT_ID;

    if (!to) {
        Logger.write("❌ OUTBOUND: missing 'to' in script_custom_data");
        VoxEngine.terminate();
        return;
    }

    Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    Logger.write("🚀 OUTBOUND START");
    Logger.write("   to: " + to);
    Logger.write("   from: " + (from || "(provider default)"));
    Logger.write("   assistant_id: " + assistantId);
    Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    var configUrl =
        BACKEND_BASE_URL +
        "/api/voximplant/assistants/config/" +
        encodeURIComponent(assistantId);
    var configResponsePromise = Net.httpRequestAsync(configUrl, {
        headers: buildHeaders(),
        method: "GET",
    });
    var startupGreetingAudioPromise = (async function() {
        try {
            var configResponse = await configResponsePromise;
            if (configResponse.code !== 200) {
                return null;
            }

            var config = safeJsonParse(configResponse.text, {});
            var startupGreetingText = resolveStartupGreetingText(config);
            return await synthesizeStartupGreeting(
                config,
                assistantId,
                startupGreetingText
            );
        } catch (error) {
            Logger.write("⚠️ Startup greeting preload failed: " + error);
            return null;
        }
    })();

    var pstnCall = from ? VoxEngine.callPSTN(to, from) : VoxEngine.callPSTN(to);

    pstnCall.addEventListener(CallEvents.Connected, function() {
        Logger.write("✅ PSTN connected: " + to);
        runGeminiSession({
            call: pstnCall,
            destinationNumber: to,
            callerNumber: from || pstnCall.callerid() || "unknown",
            assistantId: assistantId,
            configResponsePromise: configResponsePromise,
            startupGreetingAudioPromise: startupGreetingAudioPromise,
        });
    });

    pstnCall.addEventListener(CallEvents.Failed, function(eventData) {
        Logger.write("❌ PSTN failed: " + JSON.stringify(eventData || {}));
        VoxEngine.terminate();
    });

    pstnCall.addEventListener(CallEvents.Disconnected, function() {
        Logger.write("📴 PSTN disconnected before session init");
    });
});
