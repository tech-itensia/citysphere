/** Demo tenants created when SEED_DEMO=true (one command gives two working cities). */
export const DEMO_TENANTS = [
  {
    id: "delhi",
    name: "New Delhi Municipal Council",
    cityName: "New Delhi",
    center: { lat: 28.6139, lon: 77.209 },
    branding: { productName: "Smart City Operating System", primary: "#2563EB", logoText: "NDMC" },
    zones: [
      { name: "Connaught Place", lat: 28.6315, lon: 77.2167 },
      { name: "Karol Bagh", lat: 28.6514, lon: 77.1907 },
      { name: "Dwarka Sector 18", lat: 28.5921, lon: 77.0460 },
      { name: "Mahipalpur", lat: 28.5450, lon: 77.1260 },
      { name: "Saket", lat: 28.5245, lon: 77.2066 },
    ],
    apiKeyEnv: "DEMO_API_KEY_DELHI",
    apiKeyDefault: "sk_delhi_demo_0000000000000000000001",
  },
  {
    id: "bengaluru",
    name: "Bruhat Bengaluru Mahanagara Palike",
    cityName: "Bengaluru",
    center: { lat: 12.9716, lon: 77.5946 },
    branding: { productName: "Smart City Operating System", primary: "#7C3AED", logoText: "BBMP" },
    zones: [
      { name: "MG Road", lat: 12.9756, lon: 77.6067 },
      { name: "Koramangala", lat: 12.9352, lon: 77.6245 },
      { name: "Whitefield", lat: 12.9698, lon: 77.7500 },
      { name: "Electronic City", lat: 12.8452, lon: 77.6602 },
    ],
    apiKeyEnv: "DEMO_API_KEY_BENGALURU",
    apiKeyDefault: "sk_bengaluru_demo_000000000000000000001",
  },
];
