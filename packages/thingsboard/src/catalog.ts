/**
 * Device catalogue: one ThingsBoard device profile per city asset type, with profile alarm rules.
 * The tb-bridge auto-creates devices with these profiles; ThingsBoard evaluates the alarm rules and
 * the rule chain exports alarms to Kafka (scaas.alerts), where incident-service turns them into incidents.
 */
type Op = "GREATER" | "GREATER_OR_EQUAL" | "LESS" | "LESS_OR_EQUAL" | "EQUAL" | "NOT_EQUAL";
type TbSeverity = "CRITICAL" | "MAJOR" | "MINOR" | "WARNING" | "INDETERMINATE";

interface Cond { key: string; op: Op; value: number | boolean; minutes?: number }
interface AlarmDef { type: string; create: Partial<Record<TbSeverity, Cond>>; clear?: Cond }

export interface DeviceTypeDef {
  name: string;
  prefix: string;
  domain: "lighting" | "traffic" | "environment" | "water" | "electricity" | "waste" | "parking" | "mobility" | "emergency" | "weather" | "events" | "generic";
  description: string;
  telemetry: string[];
  alarms: AlarmDef[];
}

export const DEVICE_TYPES: DeviceTypeDef[] = [
  { name: "Street Light", prefix: "SL", domain: "lighting", description: "Smart LED street light with CCMS controller",
    telemetry: ["status", "brightness", "powerW", "energyKWh", "fault", "battery"],
    alarms: [
      { type: "Lamp Fault", create: { MAJOR: { key: "fault", op: "EQUAL", value: true } }, clear: { key: "fault", op: "EQUAL", value: false } },
      { type: "Low Backup Battery", create: { MINOR: { key: "battery", op: "LESS", value: 20 } }, clear: { key: "battery", op: "GREATER_OR_EQUAL", value: 30 } },
    ] },
  { name: "Traffic Junction", prefix: "TJ", domain: "traffic", description: "ATCS junction controller with vehicle detection",
    telemetry: ["vehicleCount", "speedKmh", "queueLength", "signalPhase", "signalFault"],
    alarms: [
      { type: "Congestion", create: { CRITICAL: { key: "speedKmh", op: "LESS", value: 8, minutes: 5 }, MAJOR: { key: "speedKmh", op: "LESS", value: 15, minutes: 5 } }, clear: { key: "speedKmh", op: "GREATER_OR_EQUAL", value: 25 } },
      { type: "Signal Fault", create: { CRITICAL: { key: "signalFault", op: "EQUAL", value: true } }, clear: { key: "signalFault", op: "EQUAL", value: false } },
    ] },
  { name: "Air Quality Station", prefix: "AQ", domain: "environment", description: "Ambient air quality and noise station",
    telemetry: ["pm25", "pm10", "no2", "co2", "aqi", "noiseDb", "temperatureC", "humidity"],
    alarms: [
      { type: "High PM2.5", create: { CRITICAL: { key: "pm25", op: "GREATER", value: 120 }, MAJOR: { key: "pm25", op: "GREATER", value: 60 } }, clear: { key: "pm25", op: "LESS_OR_EQUAL", value: 50 } },
      { type: "Noise Limit Exceeded", create: { WARNING: { key: "noiseDb", op: "GREATER", value: 85, minutes: 10 } }, clear: { key: "noiseDb", op: "LESS_OR_EQUAL", value: 75 } },
    ] },
  { name: "Water Node", prefix: "WN", domain: "water", description: "Pipeline pressure, flow and quality node",
    telemetry: ["flowLpm", "pressureBar", "turbidityNtu", "levelPct", "leak"],
    alarms: [
      { type: "Low Water Pressure", create: { MAJOR: { key: "pressureBar", op: "LESS", value: 1.5, minutes: 2 } }, clear: { key: "pressureBar", op: "GREATER_OR_EQUAL", value: 2 } },
      { type: "Leak Suspected", create: { CRITICAL: { key: "leak", op: "EQUAL", value: true } }, clear: { key: "leak", op: "EQUAL", value: false } },
      { type: "High Turbidity", create: { MINOR: { key: "turbidityNtu", op: "GREATER", value: 5 } }, clear: { key: "turbidityNtu", op: "LESS_OR_EQUAL", value: 4 } },
    ] },
  { name: "Power Meter", prefix: "PM", domain: "electricity", description: "Substation / feeder smart meter",
    telemetry: ["voltage", "currentA", "loadKw", "loadPct", "powerFactor"],
    alarms: [
      { type: "Feeder Overload", create: { CRITICAL: { key: "loadPct", op: "GREATER", value: 100 }, MAJOR: { key: "loadPct", op: "GREATER", value: 90 } }, clear: { key: "loadPct", op: "LESS_OR_EQUAL", value: 80 } },
      { type: "Power Outage", create: { CRITICAL: { key: "voltage", op: "LESS", value: 50 } }, clear: { key: "voltage", op: "GREATER_OR_EQUAL", value: 200 } },
    ] },
  { name: "Smart Bin", prefix: "WB", domain: "waste", description: "Ultrasonic fill-level bin sensor",
    telemetry: ["fillPct", "temperatureC", "battery"],
    alarms: [
      { type: "Bin Almost Full", create: { MAJOR: { key: "fillPct", op: "GREATER", value: 85 } }, clear: { key: "fillPct", op: "LESS", value: 30 } },
      { type: "Bin Fire Risk", create: { CRITICAL: { key: "temperatureC", op: "GREATER", value: 60 } }, clear: { key: "temperatureC", op: "LESS_OR_EQUAL", value: 45 } },
    ] },
  { name: "Parking Sensor", prefix: "PK", domain: "parking", description: "In-ground parking bay occupancy sensor",
    telemetry: ["occupied", "dwellMin"],
    alarms: [{ type: "Parking Overstay", create: { WARNING: { key: "dwellMin", op: "GREATER", value: 240 } }, clear: { key: "dwellMin", op: "LESS_OR_EQUAL", value: 240 } }] },
  { name: "Vehicle", prefix: "VH", domain: "mobility", description: "Municipal vehicle tracker (buses, garbage trucks)",
    telemetry: ["speedKmh", "heading", "battery", "fuelPct"],
    alarms: [{ type: "Overspeed", create: { MINOR: { key: "speedKmh", op: "GREATER", value: 70 } }, clear: { key: "speedKmh", op: "LESS_OR_EQUAL", value: 60 } }] },
  { name: "Drone", prefix: "DR", domain: "mobility", description: "Surveillance / delivery drone",
    telemetry: ["altitudeM", "speedKmh", "battery", "heading"],
    alarms: [{ type: "Drone Low Battery", create: { MAJOR: { key: "battery", op: "LESS", value: 15 } }, clear: { key: "battery", op: "GREATER_OR_EQUAL", value: 30 } }] },
  { name: "Air Taxi", prefix: "AT", domain: "mobility", description: "eVTOL air taxi telemetry",
    telemetry: ["altitudeM", "speedKmh", "battery", "passengers"],
    alarms: [{ type: "Air Taxi Low Battery", create: { CRITICAL: { key: "battery", op: "LESS", value: 20 } }, clear: { key: "battery", op: "GREATER_OR_EQUAL", value: 35 } }] },
  { name: "Emergency Unit", prefix: "ER", domain: "emergency", description: "Ambulance / fire unit status",
    telemetry: ["available", "speedKmh", "assignment"], alarms: [] },
  { name: "Weather Feed", prefix: "WX", domain: "weather", description: "Virtual device fed by the weather connector",
    telemetry: ["temperatureC", "humidity", "rainMm", "windKmh", "weatherCode"],
    alarms: [
      { type: "Heavy Rain", create: { MAJOR: { key: "rainMm", op: "GREATER", value: 20 } }, clear: { key: "rainMm", op: "LESS_OR_EQUAL", value: 5 } },
      { type: "Heatwave", create: { MAJOR: { key: "temperatureC", op: "GREATER", value: 44 } }, clear: { key: "temperatureC", op: "LESS_OR_EQUAL", value: 40 } },
    ] },
  { name: "City Event Feed", prefix: "EV", domain: "events", description: "Virtual device for public events (crowds, closures)",
    telemetry: ["expectedCrowd", "active", "roadClosure"], alarms: [] },
  { name: "Generic Sensor", prefix: "GS", domain: "generic", description: "Any device without a catalogue type", telemetry: [], alarms: [] },
];

export const deviceTypeByName = (name: string) => DEVICE_TYPES.find((d) => d.name === name);

function stableAlarmId(profile: string, type: string): string {
  // Deterministic id so re-provisioning updates rather than duplicates rules.
  let h = 0;
  for (const ch of `${profile}/${type}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `scaas-${h.toString(16)}`;
}

function condition(c: Cond) {
  const isBool = typeof c.value === "boolean";
  return {
    condition: [{
      key: { type: "TIME_SERIES", key: c.key },
      valueType: isBool ? "BOOLEAN" : "NUMERIC",
      value: null,
      predicate: { type: isBool ? "BOOLEAN" : "NUMERIC", operation: c.op, value: { defaultValue: c.value, userValue: null, dynamicValue: null } },
    }],
    spec: c.minutes
      ? { type: "DURATION", unit: "MINUTES", predicate: { defaultValue: c.minutes, userValue: null, dynamicValue: null } }
      : { type: "SIMPLE" },
  };
}

/** ThingsBoard device-profile JSON (DEFAULT transport) including profile alarm rules. */
export function deviceProfileBody(def: DeviceTypeDef): Record<string, unknown> {
  return {
    name: def.name,
    description: def.description,
    type: "DEFAULT",
    transportType: "DEFAULT",
    provisionType: "DISABLED",
    profileData: {
      configuration: { type: "DEFAULT" },
      transportConfiguration: { type: "DEFAULT" },
      provisionConfiguration: { type: "DISABLED", provisionDeviceSecret: null },
      alarms: def.alarms.map((a) => ({
        id: stableAlarmId(def.name, a.type),
        alarmType: a.type,
        propagate: true,
        propagateToOwner: false,
        propagateToTenant: false,
        propagateRelationTypes: ["Contains"],
        createRules: Object.fromEntries(Object.entries(a.create).map(([sev, c]) => [sev, { condition: condition(c as Cond), schedule: null, alarmDetails: null, dashboardId: null }])),
        clearRule: a.clear ? { condition: condition(a.clear), schedule: null, alarmDetails: null, dashboardId: null } : null,
      })),
    },
  };
}
