import { z } from "zod";

import { FirstStepSchema } from "./first-step";
import { SecondStepSchema } from "./second-step";

export const CreateGroupSchema = FirstStepSchema.merge(SecondStepSchema);

export type CreateGroupInput = z.infer<typeof CreateGroupSchema>;

export * from "./first-step";
export * from "./second-step";
