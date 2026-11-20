// Shapes returned by the Express API in /server.

export interface DirectionsResult {
  distanceKm: number;
  durationMin: number;
  polyline: string;
  status: string;
}

export interface BdzDeparture {
  trainName: string;
  departTime: string;
  arriveTime: string;
  departDate: string;
  arriveDate: string;
  totalTime: string;
  totalMinutes: number;
  distanceKm: number;
  transfers: number;
  hasFirstClass: boolean;
  hasSecondClass: boolean;
  isDelayed: boolean;
}

export interface BdzScheduleResult {
  supported: boolean;
  fromName?: string;
  toName?: string;
  date?: string;
  departures: BdzDeparture[];
  error?: string;
}
