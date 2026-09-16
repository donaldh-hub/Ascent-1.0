export * from "./generated/api";
export * from "./generated/types";

// The names below exist in both ./generated/api (as a zod schema value,
// used at runtime for .parse()/.safeParse()) and ./generated/types (as a
// plain interface, used only in type positions). `export *` treats a name
// re-exported from two modules as ambiguous and drops it entirely, so it
// has to be re-exported explicitly here — as whichever of the two forms
// its real callers need. Re-exporting both the value and the type under
// the same bare name isn't possible here (TS treats a plain `export { X }`
// of a value as also claiming the type position, which then collides with
// a separate `export type { X }` for the same name), so: names actual
// route handlers call .parse()/.safeParse() on get the value; everything
// else keeps the plain type it had before.
export {
  CreateAssetBody,
  CreateStageBody,
  CreateWorkflowBody,
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
  UpdateAssetBody,
  UpdateStageBody,
  UpdateWorkflowBody,
} from "./generated/api";
export type {
  CreateDocumentBody,
  CreatePropertyBody,
  CreateUnitBody,
  CreateWorkflowItemBody,
  ImportUnitsBody,
  ImportWorkOrdersBody,
  ListWorkflowItemsParams,
  MoveWorkflowItemBody,
  UpdatePropertyBody,
  UpdateWorkflowItemBody,
} from "./generated/types";
