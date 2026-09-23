export type ResourceType = "room" | "vehicle" | "equipment" | "custom";

export interface ResourceDefinition {
  id: string;
  name: string;
  type: ResourceType;
}
