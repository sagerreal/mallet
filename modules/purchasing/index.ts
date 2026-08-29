// Public surface for the purchasing module — the only sanctioned import seam.
export { createPurchaseOrderRouter } from "./api/purchase-order-router";
export type {
  PurchaseOrder,
  PurchaseOrderProps,
  POLineProps,
  POStatus,
} from "./domain/purchase-order";
export type { PurchaseOrderRepository, PONoteRow } from "./domain/purchase-order-repository";
export { ListPurchaseOrdersUseCase } from "./app/list-purchase-orders";
export { CreatePurchaseOrderUseCase } from "./app/create-purchase-order";
export { UpdatePurchaseOrderUseCase } from "./app/update-purchase-order";
export { PlacePurchaseOrderUseCase } from "./app/place-purchase-order";
export { CancelPurchaseOrderUseCase } from "./app/cancel-purchase-order";
export { RemovePurchaseOrderUseCase } from "./app/remove-purchase-order";
export { AddPurchaseOrderNoteUseCase } from "./app/add-purchase-order-note";
export { DrizzlePurchaseOrderRepository } from "./infra/drizzle-purchase-order-repository";
