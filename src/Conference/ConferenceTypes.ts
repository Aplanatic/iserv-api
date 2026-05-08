export interface ConferenceHealthCounter {
  meetings: number;
  participants: number;
  threads: number;
}

export interface ConferenceHealth {
  load: number;
  normalizedLoad: number;
  loadClassification: string;
  loadDescription: string;
  counter: ConferenceHealthCounter;
}
