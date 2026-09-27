export interface ServiceSummary {
  id: string;
  locationId: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  active: boolean;
  queueEnabled: boolean;
  appointmentEnabled: boolean;
  displayOrder: number;
}
