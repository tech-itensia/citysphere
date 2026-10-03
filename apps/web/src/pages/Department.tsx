import { useAuth } from "../lib/auth";
import { Incidents } from "./Incidents";

const DEPT_NAME: Record<string, string> = {
  water: "Water Supply", electricity: "Electricity", traffic: "Traffic Police", lighting: "Street Lighting", waste: "Solid Waste", environment: "Environment",
};

/** Department Head: incidents for my department (from the Keycloak group /tenants/<city>/departments/<dept>). */
export function Department() {
  const { me } = useAuth();
  const dept = DEPT_NAME[me?.departments?.[0] ?? ""];
  return <Incidents department={dept} title={dept ? `${dept} Department` : "My department"} />;
}
