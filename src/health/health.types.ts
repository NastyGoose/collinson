export type HealthStatus = 'UP' | 'DOWN';

export interface Health {
  service: HealthStatus;
  database: HealthStatus;
}
