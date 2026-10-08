// Module Văn phòng phẩm (VPP) — hằng số & kiểu dữ liệu dùng chung frontend + Worker.
// Apps Script có bản tương ứng trong apps-script/Config.gs, Vpp.gs — giữ đồng bộ khi sửa.

export const CATALOG_STATUSES = ['MASTER', 'TEMP', 'PENDING_APPROVAL', 'ARCHIVED'] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export const CATALOG_STATUS_LABELS: Record<CatalogStatus, string> = {
  MASTER: 'Danh mục',
  TEMP: 'Tạm / ngoài định mức',
  PENDING_APPROVAL: 'Chờ duyệt',
  ARCHIVED: 'Ngừng dùng',
};

export const STOCK_STATUSES = ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'UNKNOWN'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  IN_STOCK: 'Còn hàng',
  LOW_STOCK: 'Sắp hết',
  OUT_OF_STOCK: 'Hết hàng',
  UNKNOWN: 'Chưa rõ tồn',
};

export const MOVEMENT_TYPES = ['INITIAL', 'IN', 'RESERVE', 'RELEASE', 'OUT', 'ADJUSTMENT'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  INITIAL: 'Tồn đầu kỳ',
  IN: 'Nhập kho',
  RESERVE: 'Giữ chỗ',
  RELEASE: 'Trả giữ chỗ',
  OUT: 'Xuất kho',
  ADJUSTMENT: 'Điều chỉnh / kiểm kê',
};

/**
 * Số lượng theo chiều tác động (như trang Lịch sử kho hiển thị): xuất kho / trả giữ chỗ là số âm, điều chỉnh giữ dấu đã ghi,
 * còn lại dương. Sổ lưu số dương cho OUT / RELEASE.
 */
export function signedMovementQuantity(movementType: MovementType, quantity: number): number {
  if (movementType === 'ADJUSTMENT') return quantity;
  return movementType === 'OUT' || movementType === 'RELEASE' ? -Math.abs(quantity) : Math.abs(quantity);
}

export const PROPOSAL_STATUSES = [
  'SUBMITTED',
  'APPROVED',
  'PARTIALLY_APPROVED',
  'REJECTED',
  'PURCHASED',
  'RECEIVED',
  'CLOSED',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  SUBMITTED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  PARTIALLY_APPROVED: 'Duyệt một phần',
  REJECTED: 'Từ chối',
  PURCHASED: 'Đã mua',
  RECEIVED: 'Đã nhập kho',
  CLOSED: 'Đã đóng',
};

export const PRODUCT_APPROVAL_STATUSES = ['NOT_REQUIRED', 'PENDING', 'APPROVED_MASTER', 'KEPT_TEMP', 'MAPPED', 'REJECTED'] as const;
export type ProductApprovalStatus = (typeof PRODUCT_APPROVAL_STATUSES)[number];

export const PRODUCT_APPROVAL_LABELS: Record<ProductApprovalStatus, string> = {
  NOT_REQUIRED: 'Có trong danh mục',
  PENDING: 'Chờ quyết định',
  APPROVED_MASTER: 'Đã thêm vào danh mục',
  KEPT_TEMP: 'Giữ tạm',
  MAPPED: 'Đã ghép sản phẩm có sẵn',
  REJECTED: 'Đã từ chối',
};

export const STOCK_IN_REASONS = ['MUA_TRUC_TIEP', 'BO_SUNG', 'CHUYEN_KHO', 'TON_DAU_KY', 'KHAC'] as const;
export type StockInReason = (typeof STOCK_IN_REASONS)[number];

export const STOCK_IN_REASON_LABELS: Record<StockInReason, string> = {
  MUA_TRUC_TIEP: 'Mua trực tiếp',
  BO_SUNG: 'Bổ sung',
  CHUYEN_KHO: 'Chuyển kho',
  TON_DAU_KY: 'Tồn đầu kỳ',
  KHAC: 'Khác',
};

/** available ≤ 0 → hết; ≤ tối thiểu → sắp hết; tồn chưa rõ → UNKNOWN. Khớp computeStockStatus_ (Vpp.gs). */
export function stockStatusOf(available: number | null, minimumStock: number): StockStatus {
  if (available === null) return 'UNKNOWN';
  if (available <= 0) return 'OUT_OF_STOCK';
  if (available <= (minimumStock || 0)) return 'LOW_STOCK';
  return 'IN_STOCK';
}

export interface StockView {
  onHand: number | null;
  reserved: number;
  available: number | null;
  minimumStock: number;
  needsReview: boolean;
  rawInitialValue: string;
  status: StockStatus;
  updatedAt: string;
  updatedBy: string;
}

export interface VppProduct {
  productId: string;
  productCode: string;
  productName: string;
  category: string;
  unit: string;
  referencePrice: number | null;
  minimumStock: number;
  catalogStatus: CatalogStatus;
  active: boolean;
  source: string;
  reviewStatus: string;
  mergedIntoProductId: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  stock: StockView;
  normCount?: number;
}

export interface NormUsage {
  monthlyQuantity: number;
  issued: number;
  pending: number;
  remaining: number;
}

export interface HandoverContextProduct extends VppProduct {
  reservedByThisHandover: number;
  norm: NormUsage | null;
}

export interface NormScope {
  scopeId: string;
  scopeName: string;
  source?: 'MAPPING' | 'AUTO';
}

export interface VppHandoverContext {
  receiver: { employeeId: string; fullName: string; department: string; position: string } | null;
  scope: NormScope | null;
  month: string;
  products: HandoverContextProduct[];
}

export interface VppNorm {
  normId: string;
  productId: string;
  productName: string;
  productCode: string;
  productUnit: string;
  scopeType: string;
  scopeId: string;
  scopeName: string;
  monthlyQuantity: number;
  unit: string;
  referencePrice: number | null;
  note: string;
  effectiveFrom: string;
  effectiveTo: string;
  active: boolean;
  /** Đang áp dụng: bật, trong thời hạn VÀ sản phẩm còn dùng được (không lưu trữ / ngừng dùng / chờ duyệt). */
  effective: boolean;
  /** Sản phẩm của định mức đã lưu trữ / ngừng dùng (ví dụ đã GHÉP vào sản phẩm khác) — định mức không còn áp dụng. */
  productInactive?: boolean;
  sourceRef: string;
  createdAt: string;
  updatedAt: string;
}

export interface DepartmentScope {
  department: string;
  employeeCount: number;
  scope: NormScope | null;
  /** Giá trị gắn thủ công: '' = tự khớp theo tên, 'NONE' = không áp dụng định mức, hoặc mã phạm vi. */
  mapping: string;
}

export interface VppNormsResponse {
  norms: VppNorm[];
  scopes: NormScope[];
  departments: DepartmentScope[];
}

export interface StockAlertItem {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  onHand: number | null;
  reserved: number;
  available: number | null;
  minimumStock: number;
  rawInitialValue: string;
  catalogStatus: CatalogStatus;
}

export interface ProposalSummary {
  proposalId: string;
  proposalCode: string;
  requesterEmployeeId: string;
  requesterName: string;
  requesterPosition: string;
  department: string;
  scopeId: string;
  status: ProposalStatus;
  reason: string;
  estimatedTotal: number | null;
  adminNote: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string;
  reviewedBy: string;
  receivedAt: string;
  closedAt: string;
  itemCount: number;
  outsideNormCount: number;
  pendingProductCount: number;
}

export interface VppDashboard {
  counts: {
    products: number;
    tempProducts: number;
    outOfStock: number;
    lowStock: number;
    unknownStock: number;
    /** Số vấn đề cần kiểm tra (một sản phẩm có thể có nhiều vấn đề). */
    needsReview: number;
    /** Số sản phẩm có ít nhất một vấn đề. */
    needsReviewProducts: number;
    submittedProposals: number;
    approvedProposals: number;
    /** Phiếu VPP chờ ký (PENDING) — đang giữ chỗ. */
    pendingHandovers: number;
    /** Phiếu VPP người nhận yêu cầu sửa (REVISION_REQUESTED) — vẫn giữ chỗ. */
    revisionHandovers: number;
    reservedUnits: number;
  };
  outOfStock: StockAlertItem[];
  lowStock: StockAlertItem[];
  unknown: StockAlertItem[];
  recentProposals: ProposalSummary[];
}

export interface VppAlertsSummary {
  ready: boolean;
  outOfStock: StockAlertItem[];
  outOfStockCount: number;
  lowStock: StockAlertItem[];
  lowStockCount: number;
  /** Số vấn đề cần kiểm tra. */
  needsReviewCount: number;
  /** Số sản phẩm có ít nhất một vấn đề. */
  needsReviewProducts: number;
  submittedProposals: number;
}

export interface StockMovement {
  movementId: string;
  productId: string;
  productName: string;
  productCode: string;
  unit: string;
  movementType: MovementType;
  quantity: number;
  onHandBefore: number | null;
  onHandAfter: number | null;
  reservedBefore: number;
  reservedAfter: number;
  handoverId: string;
  handoverCode: string;
  proposalId: string;
  proposalCode: string;
  operationId: string;
  actorId: string;
  actorName: string;
  reason: string;
  createdAt: string;
}

export interface MovementListResponse {
  items: StockMovement[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProposalItem {
  proposalItemId: string;
  proposalId: string;
  productId: string;
  temporaryProductName: string;
  isOutsideNorm: boolean;
  unit: string;
  requestedQuantity: number;
  normQuantity: number | null;
  approvedQuantity: number | null;
  referencePrice: number | null;
  approvedPrice: number | null;
  reason: string;
  note: string;
  productApprovalStatus: ProductApprovalStatus;
  referenceUrl: string;
  receivedQuantity: number | null;
  itemOrder: number;
  displayName: string;
  product: {
    productId: string;
    productCode: string;
    productName: string;
    unit: string;
    category: string;
    catalogStatus: CatalogStatus;
    active: boolean;
    referencePrice: number | null;
  } | null;
  stock: StockView | null;
}

export interface ProposalHistoryEntry {
  logId: string;
  action: string;
  actor: string;
  oldStatus: string;
  newStatus: string;
  message: string;
  createdAt: string;
}

export interface ProposalDetail {
  proposal: Omit<ProposalSummary, 'itemCount' | 'outsideNormCount' | 'pendingProductCount'>;
  items: ProposalItem[];
  history: ProposalHistoryEntry[];
  scopes: NormScope[];
}

export interface ProposalListResponse {
  items: ProposalSummary[];
  total: number;
  page: number;
  pageSize: number;
  stats: Record<ProposalStatus, number>;
}

export interface ReviewProduct {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  category: string;
  catalogStatus: CatalogStatus;
  source: string;
  reviewStatus: string;
  note: string;
  onHand: number | null;
  reserved: number;
  rawInitialValue: string;
  needsReview: boolean;
  suggestions?: Array<{ productId: string; productCode: string; productName: string; unit: string; score: number }>;
}

export interface DataReviewResponse {
  unmapped: ReviewProduct[];
  missingUnit: ReviewProduct[];
  unclearQuantity: ReviewProduct[];
  missingNorm: ReviewProduct[];
  missingMinimumStock: ReviewProduct[];
  duplicates: Array<{ normalizedName: string; products: ReviewProduct[] }>;
  pendingApproval: ReviewProduct[];
  unmappedDepartments: Array<{ department: string; employeeCount: number }>;
  stockMismatches: Array<{ handoverId: string; handoverCode: string; status: string }>;
  /** Sản phẩm có số tồn trên sheet VPP_TON_KHO khác sổ biến động (ghi dở / sửa tay sheet). */
  stockDrifts: StockDrift[];
  scopes: NormScope[];
  masters: Array<{ productId: string; productCode: string; productName: string; unit: string }>;
}

export interface StockDrift {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  /** invalidValue: chữ gõ tay trên sheet không phải số tồn hợp lệ (âm, có phần lẻ, chữ…) — chỉ kiểm kê được. */
  sheet: { onHand: number | null; reserved: number; invalidValue?: string };
  /**
   * movements = số dòng biến động của sản phẩm trong sổ. 0 → số trên sheet chưa từng được ghi vào sổ (thường là tồn đầu kỳ
   * nhập tay): KHÔNG đồng bộ theo sổ được (sẽ xóa mất số đó) — dùng Kiểm kê với số thực tế để ghi vào sổ.
   */
  ledger: { onHand: number; reserved: number; movements: number };
}

/** Cảnh báo sau khi giữ chỗ (tạo / sửa phiếu VPP). */
export interface StockWarning {
  type: 'LAST_ITEM' | 'LOW_STOCK';
  productId: string;
  productName: string;
  available: number;
  minimumStock?: number;
}

export interface PublicEmployee {
  employeeId: string;
  fullName: string;
  department: string;
  position: string;
}

export interface PublicNorm {
  productId: string;
  productName: string;
  unit: string;
  category: string;
  monthlyQuantity: number;
}

export interface EmployeeLookupResponse {
  employee: PublicEmployee;
  scope: { scopeId: string; scopeName: string } | null;
  norms: PublicNorm[];
}

export interface PublicCatalogProduct {
  productId: string;
  productName: string;
  unit: string;
  category: string;
}

export interface ProposalSubmitResult {
  proposalCode: string;
  status: ProposalStatus;
  itemCount: number;
  duplicate: boolean;
}

/** Định dạng tiền VNĐ (giá dự kiến). */
export function formatVnd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${Math.round(value).toLocaleString('vi-VN')} ₫`;
}
