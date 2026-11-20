// Shapes returned by the Express API in /server.

export interface DirectionsResult {
  distanceKm: number;
  durationMin: number;
  polyline: string;
  status: string;
}

export interface TripAlert {
  level: "info" | "warning" | "delay";
  title: string;
  body: string;
  source: string;
  /** ISO time the underlying data was fetched. */
  updatedAt: string;
}

export interface AlertsResult {
  alerts: TripAlert[];
  /** Sources that were checked successfully. */
  checked: string[];
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
  /** Live delay in minutes from BDŽ's departures board (today's upcoming trains only). */
  delayMin?: number;
  /** Regular adult fare in EUR; missing when that class isn't sold or BDŽ didn't return a price. */
  priceSecondClass?: number;
  priceFirstClass?: number;
  /** ok: fare found; none: BDŽ sells no regular online fare; pending: BDŽ hasn't answered yet. */
  priceStatus?: "ok" | "none" | "pending";
}

export interface BdzScheduleResult {
  supported: boolean;
  fromName?: string;
  toName?: string;
  date?: string;
  departures: BdzDeparture[];
  error?: string;
}
