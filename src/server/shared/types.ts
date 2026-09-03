export interface TranscriptLine {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
}

export interface AudioSegment {
  filename: string;
  startMs: number;
  endMs: number;
  path: string;
}
