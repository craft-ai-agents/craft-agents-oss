declare module "vosk-browser" {
  export type KaldiRecognizer = {
    id: string;
    on: (
      event: "result" | "partialresult",
      handler: (message: {
        result: { text?: string; partial?: string };
      }) => void,
    ) => void;
    setWords: (words: boolean) => void;
    acceptWaveform: (buffer: AudioBuffer) => void;
    acceptWaveformFloat: (buffer: Float32Array, sampleRate: number) => void;
    retrieveFinalResult: () => void;
    remove: () => void;
  };

  export type Model = {
    ready: boolean;
    KaldiRecognizer: new (
      sampleRate: number,
      grammar?: string,
    ) => KaldiRecognizer;
    terminate: () => void;
  };

  export function createModel(url: string): Promise<Model>;
}
