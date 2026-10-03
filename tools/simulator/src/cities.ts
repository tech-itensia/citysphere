/** Matches the demo tenants seeded by tenant-service. Add your own city here. */
export interface CityDef { tenantId: string; center: { lat: number; lon: number }; zones: Array<{ name: string; lat: number; lon: number }> }

export const CITIES: Record<string, CityDef> = {
  delhi: {
    tenantId: "delhi",
    center: { lat: 28.6139, lon: 77.209 },
    zones: [
      { name: "Connaught Place", lat: 28.6315, lon: 77.2167 },
      { name: "Karol Bagh", lat: 28.6514, lon: 77.1907 },
      { name: "Dwarka Sector 18", lat: 28.5921, lon: 77.046 },
      { name: "Mahipalpur", lat: 28.545, lon: 77.126 },
      { name: "Saket", lat: 28.5245, lon: 77.2066 },
    ],
  },
  bengaluru: {
    tenantId: "bengaluru",
    center: { lat: 12.9716, lon: 77.5946 },
    zones: [
      { name: "MG Road", lat: 12.9756, lon: 77.6067 },
      { name: "Koramangala", lat: 12.9352, lon: 77.6245 },
      { name: "Whitefield", lat: 12.9698, lon: 77.75 },
      { name: "Electronic City", lat: 12.8452, lon: 77.6602 },
    ],
  },
};
