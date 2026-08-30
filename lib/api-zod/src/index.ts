export * from "./generated/api";
export * from "./generated/types";

// The names below exist in both ./generated/api (as a zod schema value) and
// ./generated/types (as a plain interface). `export *` won't merge the two
// across separate wildcard re-exports, so re-export the type explicitly to
// resolve the ambiguity — the zod value keeps flowing through the wildcard
// above unaffected.
export type {
  CreateAssetBody,
  CreateDocumentBody,
  CreatePropertyBody,
  CreateStageBody,
  CreateUnitBody,
  CreateWorkflowBody,
  CreateWorkflowItemBody,
  ImportUnitsBody,
  ImportWorkOrdersBody,
  ListWorkflowItemsParams,
  MoveWorkflowItemBody,
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
  UpdateAssetBody,
  UpdatePropertyBody,
  UpdateStageBody,
  UpdateWorkflowBody,
  UpdateWorkflowItemBody,
} from "./generated/types";
