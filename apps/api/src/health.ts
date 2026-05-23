export type HealthPayload = {
  ok: true;
  service: "api";
};

export function getHealthPayload(): HealthPayload {
  return {
    ok: true,
    service: "api"
  };
}
