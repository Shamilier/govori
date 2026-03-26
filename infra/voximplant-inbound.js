/**
 * GovorI — Voximplant INBOUND Script
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
 *   4. Script sends text to backend /synthesize → gets audio URL
 *   5. Script plays audio URL via call.startPlayback()
 *   6. Repeat until call ends
 *
 * Setup:
 *   - Replace BACKEND_BASE_URL with your GovorI server URL
 *   - Replace AGENT_ID with your agent ID from the GovorI database
 *   - Set WEBHOOK_SECRET if configured on the backend
 */

require(Modules.OpenAI);

// ============================================================
// CONFIGURATION — change these for your deployment
// ============================================================
const BACKEND_BASE_URL = "https://your-server.com"; // GovorI backend URL
const AGENT_ID = "default"; // Agent ID from GovorI DB (or "default" for first active agent)
const WEBHOOK_SECRET = ""; // Set if VOXIMPLANT_WEBHOOK_SECRET is configured

// Derived URLs
const CONFIG_URL = BACKEND_BASE_URL + "/api/voximplant/assistants/config/" + AGENT_ID;
const TTS_URL = BACKEND_BASE_URL + "/api/voximplant/synthesize";
const FUNCTIONS_URL = BACKEND_BASE_URL + "/api/voximplant/functions/execute";
const LOG_URL = BACKEND_BASE_URL + "/api/voximplant/log";

// ============================================================
// MAIN HANDLER
// ============================================================
VoxEngine.addEventListener(AppEvents.CallAlerting, async ({ call }) => {
    let realtimeClient = undefined;
    let isTerminating = false;
    const chatId = "vox_" + Math.random().toString(36).substring(2, 15);
    const callerNumber = call.callerid() || "unknown";
    const callId = call.id();

    Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    Logger.write("📞 INBOUND CALL — GovorI + Cartesia TTS");
    Logger.write("   Caller: " + callerNumber + ", Call ID: " + callId);
    Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Conversation state for logging
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

        // Send final log
        if (lastUserMessage || lastAssistantMessage) {
            sendConversationLog();
        }

        // Notify backend that call ended
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
            const payload = {
                assistant_id: AGENT_ID,
                chat_id: chatId,
                call_id: callId,
                caller_number: callerNumber,
                type: extra.type || "conversation",
                data: extra.data || {}
            };

            await Net.httpRequestAsync(LOG_URL, {
                headers: buildHeaders(),
                method: "POST",
                postData: JSON.stringify(payload)
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

    /**
     * Synthesize text via backend (Cartesia) and play in call.
     * Returns a promise that resolves when audio starts playing.
     */
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
                    assistant_id: AGENT_ID
                })
            });

            if (response.code !== 200) {
                Logger.write("❌ TTS failed: HTTP " + response.code);
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

    /**
     * Terminate the call gracefully with an optional farewell message.
     */
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
            // Wait for playback to finish before hanging up
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
        const configResponse = await Net.httpRequestAsync(CONFIG_URL, {
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
        await sendLogToBackend({
            type: "call_started",
            data: { agent_name: config.assistant_name }
        });

        // 2. Build function list for OpenAI
        let openaiTools = [];
        const functionNameToIdMap = {};

        if (config.functions && Array.isArray(config.functions)) {
            openaiTools = config.functions.map((tool, index) => {
                if (tool.type === "function" && tool.function) {
                    const fId = (index + 1).toString();
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
        Logger.write("🔌 Connecting to OpenAI Realtime API (text mode)...");
        realtimeClient = await OpenAI.createRealtimeAPIClient({
            apiKey: config.api_key,
            model: config.model,
            type: OpenAI.RealtimeAPIClientType.REALTIME,
            onWebSocketClose: function () {
                Logger.write("🔌 OpenAI WebSocket closed");
                if (!isTerminating) {
                    VoxEngine.terminate();
                }
            }
        });

        Logger.write("✅ OpenAI connected");

        // 4. Configure session — TEXT-ONLY output (no OpenAI TTS)
        //    STT is still handled by OpenAI via input audio transcription
        const sessionUpdate = {
            session: {
                modalities: ["text"],  // KEY: text only output, no audio from OpenAI
                instructions: config.prompt,
                input_audio_transcription: {
                    model: "gpt-4o-transcribe",
                    language: config.language || "ru"
                },
                tools: openaiTools,
                tool_choice: "auto"
            }
        };

        realtimeClient.sessionUpdate(sessionUpdate);
        Logger.write("✅ Session configured — modalities: [text], STT: gpt-4o-transcribe");

        // 5. Send audio FROM caller TO OpenAI (one-way: caller → OpenAI for STT)
        realtimeClient.sendMediaTo(call);
        Logger.write("🎙️ Caller audio → OpenAI STT (one-way)");

        // 6. Play greeting via Cartesia TTS
        if (config.hello) {
            Logger.write("👋 Playing greeting via Cartesia...");
            await synthesizeAndPlay(config.hello);
        }

        // Also tell OpenAI about the greeting so it has context
        if (config.hello) {
            realtimeClient.conversationItemCreate({
                item: {
                    type: "message",
                    role: "assistant",
                    content: [{
                        type: "text",
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
            (event) => {
                try {
                    const transcript = event.data?.payload?.transcript;
                    if (!transcript) return;

                    Logger.write("👤 User: \"" + transcript + "\"");
                    lastUserMessage = transcript;
                } catch (error) {
                    Logger.write("❌ STT handler error: " + error);
                }
            }
        );
        Logger.write("✅ User transcription handler registered");

        // 🤖 ASSISTANT TEXT RESPONSE (OpenAI LLM — text mode)
        realtimeClient.addEventListener(
            OpenAI.RealtimeAPIEvents.ResponseTextDone,
            async (event) => {
                try {
                    const text = event.data?.payload?.text;
                    if (!text) return;

                    Logger.write("🤖 Assistant: \"" + text.substring(0, 100) + "\"");
                    lastAssistantMessage = text;

                    // Synthesize via Cartesia and play
                    await synthesizeAndPlay(text);

                    // Log the conversation pair
                    if (lastUserMessage && lastAssistantMessage) {
                        await sendConversationLog();
                    }
                } catch (error) {
                    Logger.write("❌ Response handler error: " + error);
                }
            }
        );
        Logger.write("✅ Text response handler registered (Cartesia TTS)");

        // 🔧 FUNCTION CALLS
        realtimeClient.addEventListener(
            OpenAI.RealtimeAPIEvents.ResponseOutputItemDone,
            async (event) => {
                try {
                    const item = event.data?.payload?.item;
                    if (!item || item.type !== "function_call") return;

                    const functionName = item.name;
                    const argumentsStr = item.arguments;
                    const functionCallId = item.call_id;

                    if (!functionName || !argumentsStr) return;

                    Logger.write("🔧 Function: " + functionName + " — " + argumentsStr);

                    const args = JSON.parse(argumentsStr);

                    // HANGUP — handle locally
                    if (functionName === "hangup_call") {
                        // Send function result back to OpenAI
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
                    const fId = functionNameToIdMap[functionName];
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

                    const funcResponse = await Net.httpRequestAsync(FUNCTIONS_URL, {
                        headers: buildHeaders(),
                        method: "POST",
                        postData: JSON.stringify({
                            function_id: fId,
                            arguments: args,
                            call_data: {
                                call_id: callId,
                                chat_id: chatId,
                                assistant_id: AGENT_ID,
                                caller_number: callerNumber
                            }
                        })
                    });

                    let funcResult;
                    if (funcResponse.code === 200) {
                        funcResult = JSON.parse(funcResponse.text);
                        Logger.write("✅ Function result: " + JSON.stringify(funcResult).substring(0, 150));
                    } else {
                        funcResult = { error: "Function failed: HTTP " + funcResponse.code };
                        Logger.write("❌ Function failed: HTTP " + funcResponse.code);
                    }

                    lastFunctionResult = funcResult;

                    // Return result to OpenAI so it can continue the conversation
                    realtimeClient.conversationItemCreate({
                        item: {
                            type: "function_call_output",
                            call_id: functionCallId,
                            output: JSON.stringify(funcResult)
                        }
                    });
                    realtimeClient.responseCreate();

                } catch (error) {
                    Logger.write("❌ Function handler error: " + error);
                }
            }
        );
        Logger.write("✅ Function call handler registered");

        // 🔇 INTERRUPTION — user starts speaking while audio plays
        realtimeClient.addEventListener(
            OpenAI.RealtimeAPIEvents.InputAudioBufferSpeechStarted,
            () => {
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
        Logger.write("✅ Interruption handler registered");

        // ⚠️ ERROR HANDLING
        realtimeClient.addEventListener(
            OpenAI.RealtimeAPIEvents.ResponseError || "response.error",
            (event) => {
                Logger.write("⚠️ OpenAI error: " + JSON.stringify(event.data).substring(0, 300));
            }
        );

        Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        Logger.write("🎉 READY — GovorI + OpenAI STT + Cartesia TTS");
        Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    } catch (error) {
        Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        Logger.write("❌ CRITICAL ERROR: " + error);
        if (error.stack) Logger.write("   Stack: " + error.stack);
        Logger.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        VoxEngine.terminate();
    }
});
