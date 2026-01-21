import * as React from "react";

type VoskModel = import("vosk-browser").Model;
type KaldiRecognizer = import("vosk-browser").KaldiRecognizer;

type VoskResultMessage = {
  result: {
    text?: string;
  };
};

type VoskPartialMessage = {
  result: {
    partial?: string;
  };
};

type SpeechResultHandler = (text: string) => void;

type VoskSpeechRecognitionOptions = {
  modelUrl: string;
  getAudioStream?: () => Promise<MediaStream>;
  onPartialResult?: SpeechResultHandler;
  onFinalResult?: SpeechResultHandler;
  onError?: (message: string) => void;
};

type SpeechStatus = "idle" | "loading" | "listening";

export function useVoskSpeechRecognition({
  modelUrl,
  getAudioStream,
  onPartialResult,
  onFinalResult,
  onError,
}: VoskSpeechRecognitionOptions) {
  const [status, setStatus] = React.useState<SpeechStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const statusLogRef = React.useRef<string[]>([]);
  const statusRef = React.useRef<SpeechStatus>(status);

  const modelRef = React.useRef<VoskModel | null>(null);
  const recognizerRef = React.useRef<KaldiRecognizer | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const mediaStreamRef = React.useRef<MediaStream | null>(null);
  const processorRef = React.useRef<ScriptProcessorNode | null>(null);
  const sourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null);
  const gainRef = React.useRef<GainNode | null>(null);
  const audioDetectedRef = React.useRef(false);

  const isSupported =
    typeof window !== "undefined" &&
    typeof AudioContext !== "undefined" &&
    (!!getAudioStream || !!navigator.mediaDevices?.getUserMedia);

  const reportError = React.useCallback(
    (message: string) => {
      setError(message);
      onError?.(message);
    },
    [onError],
  );

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    (
      window as typeof window & {
        __voskStatus?: {
          status: SpeechStatus;
          error: string | null;
          events: string[];
        };
      }
    ).__voskStatus = {
      status,
      error,
      events: statusLogRef.current,
    };
  }, [error, status]);

  React.useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const cleanupAudioGraph = React.useCallback(async () => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    gainRef.current?.disconnect();

    processorRef.current = null;
    sourceRef.current = null;
    gainRef.current = null;

    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current
        .getTracks()
        .forEach((track: MediaStreamTrack) => track.stop());
      mediaStreamRef.current = null;
    }
  }, []);

  const removeRecognizer = React.useCallback(() => {
    recognizerRef.current?.remove();
    recognizerRef.current = null;
  }, []);

  const loadModel = React.useCallback(async () => {
    if (modelRef.current) return modelRef.current;

    const { createModel } = await import("vosk-browser");
    const model = await createModel(modelUrl);
    modelRef.current = model;

    return model;
  }, [modelUrl]);

  const startListening = React.useCallback(async () => {
    if (!isSupported || statusRef.current !== "idle") return;

    setError(null);
    setStatus("loading");
    statusLogRef.current = [...statusLogRef.current, `start:${Date.now()}`];

    try {
      const model = await loadModel();

      const mediaStream = getAudioStream
        ? await getAudioStream()
        : await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              channelCount: 1,
            },
          });

      const audioContext = new AudioContext({ sampleRate: 16000 });
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      const recognizer = new model.KaldiRecognizer(audioContext.sampleRate);
      recognizerRef.current = recognizer;

      recognizer.on("result", (message: VoskResultMessage) => {
        const text = message.result.text?.trim() ?? "";
        if (text) {
          onFinalResult?.(text);
        }
      });

      recognizer.on("partialresult", (message: VoskPartialMessage) => {
        const text = message.result.partial?.trim() ?? "";
        if (text) {
          onPartialResult?.(text);
        }
      });
      const source = audioContext.createMediaStreamSource(mediaStream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const gain = audioContext.createGain();
      gain.gain.value = 0;

      processor.onaudioprocess = (event) => {
        try {
          recognizer.acceptWaveform(event.inputBuffer);
          if (!audioDetectedRef.current) {
            const channelData = event.inputBuffer.getChannelData(0);
            let peak = 0;
            for (let i = 0; i < channelData.length; i += 1) {
              const value = Math.abs(channelData[i]);
              if (value > peak) peak = value;
            }
            if (peak > 0.01) {
              audioDetectedRef.current = true;
              statusLogRef.current = [
                ...statusLogRef.current,
                `audio:${Date.now()}`,
              ];
            }
          }
        } catch (error) {
          reportError(
            error instanceof Error
              ? error.message
              : "Microphone processing failed",
          );
        }
      };

      source.connect(processor);
      processor.connect(gain);
      gain.connect(audioContext.destination);

      audioContextRef.current = audioContext;
      mediaStreamRef.current = mediaStream;
      processorRef.current = processor;
      sourceRef.current = source;
      gainRef.current = gain;

      setStatus("listening");
      statusLogRef.current = [
        ...statusLogRef.current,
        `listening:${Date.now()}`,
      ];
    } catch (error) {
      await cleanupAudioGraph();
      removeRecognizer();
      setStatus("idle");
      statusLogRef.current = [...statusLogRef.current, `error:${Date.now()}`];
      reportError(
        error instanceof Error ? error.message : "Microphone access failed",
      );
    }
  }, [
    cleanupAudioGraph,
    getAudioStream,
    isSupported,
    loadModel,
    onFinalResult,
    onPartialResult,
    removeRecognizer,
    reportError,
    status,
  ]);

  const stopListening = React.useCallback(async () => {
    if (statusRef.current === "idle") return;

    await cleanupAudioGraph();
    removeRecognizer();
    setStatus("idle");
    statusLogRef.current = [...statusLogRef.current, `stop:${Date.now()}`];
  }, [cleanupAudioGraph, removeRecognizer]);

  const toggleListening = React.useCallback(async () => {
    if (statusRef.current === "listening") {
      statusLogRef.current = [
        ...statusLogRef.current,
        `toggle-stop:${Date.now()}`,
      ];
      await stopListening();
      return;
    }

    statusLogRef.current = [
      ...statusLogRef.current,
      `toggle-start:${Date.now()}`,
    ];
    await startListening();
  }, [startListening, stopListening]);

  React.useEffect(() => {
    return () => {
      void stopListening();
      modelRef.current?.terminate();
      modelRef.current = null;
    };
  }, [stopListening]);

  return {
    isSupported,
    isLoading: status === "loading",
    isListening: status === "listening",
    error,
    startListening,
    stopListening,
    toggleListening,
  };
}
