// Module Đồng phục (DP) — hằng số & kiểu dữ liệu dùng chung frontend + Worker.
// Apps Script có bản tương ứng trong apps-script/Config.gs, Uniform.gs — giữ đồng bộ khi sửa.
//
// Khái niệm:
//   • Mẫu (model)      — DP_MAU: "Áo sơmi đỏ", "Áo dài vàng", "Áo thun cá sấu", "Áo bảo hộ"… (giới tính, các size, có tính vào
//                         tiêu chuẩn cấp phát năm hay không).
//   • Mặt hàng (SKU)   — DP_BIEN_THE: mẫu × size × tình trạng (Mới / Đã qua sử dụng). Kho, giữ chỗ, xuất kho tính theo mặt hàng.
//   • Tiêu chuẩn năm   — DP_DINH_MUC: số áo mỗi nhân viên được cấp / năm theo nhóm (phạm vi) — mặc định CAU_HINH.DP_TIEU_CHUAN_NAM
//                         = 3 (Chính sách người lao động 19/08/2025, mục VII.2).
//   • Phiếu đồng phục  — BAN_GIAO.handover_type = UNIFORM; mỗi dòng: mặt hàng + SL + Cấp phát / Cho mượn (hạn trả).
//   • Trả / thu hồi    — DP_THU_HOI: nhân viên trả lại (nhập lại kho) / báo hư hỏng / mất.

import type { NormScope, StockStatus, StockView } from './vpp';

/** Loại nội dung (LOAI_BAN_GIAO.code) dành riêng cho đồng phục — chỉ dùng trong phiếu UNIFORM. */
export const UNIFORM_CATEGORY_CODE = 'DONG_PHUC';

/** Giới tính áp dụng của MẪU. */
export const UNIFORM_GENDERS = ['NAM', 'NU', 'UNISEX'] as const;
export type UniformGender = (typeof UNIFORM_GENDERS)[number];
export const UNIFORM_GENDER_LABELS: Record<UniformGender, string> = { NAM: 'Nam', NU: 'Nữ', UNISEX: 'Nam & nữ' };

/** Giới tính của NHÂN VIÊN (NHAN_VIEN.gender) — '' = chưa khai báo. */
export const EMPLOYEE_GENDERS = ['NAM', 'NU'] as const;
export type EmployeeGender = (typeof EMPLOYEE_GENDERS)[number];
export const EMPLOYEE_GENDER_LABELS: Record<EmployeeGender, string> = { NAM: 'Nam', NU: 'Nữ' };

export const UNIFORM_KINDS = ['UNIFORM', 'PPE', 'OTHER'] as const;
export type UniformKind = (typeof UNIFORM_KINDS)[number];
export const UNIFORM_KIND_LABELS: Record<UniformKind, string> = {
  UNIFORM: 'Đồng phục',
  PPE: 'Bảo hộ lao động',
  OTHER: 'Khác',
};

/** Tình trạng của mặt hàng trong kho. */
export const UNIFORM_CONDITIONS = ['NEW', 'USED'] as const;
export type UniformCondition = (typeof UNIFORM_CONDITIONS)[number];
export const UNIFORM_CONDITION_LABELS: Record<UniformCondition, string> = { NEW: 'Mới', USED: 'Đã qua sử dụng' };

/** Size gợi ý khi tạo mẫu (theo danh sách đặt đồng phục 2023–2024). */
export const DEFAULT_UNIFORM_SIZES = ['S', 'M', 'L', 'XL', 'XXL'] as const;
/** Size: chữ in hoa / số / dấu gạch (S, XL, 3XL, 38, FREE). Khớp UNIFORM_SIZE_PATTERN_ (Uniform.gs). */
export const UNIFORM_SIZE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,9}$/;
export const UNIFORM_MAX_SIZES = 12;

/** Hình thức giao trên dòng phiếu đồng phục. */
export const ISSUE_KINDS = ['CAP_PHAT', 'CHO_MUON'] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];
export const ISSUE_KIND_LABELS: Record<IssueKind, string> = { CAP_PHAT: 'Cấp phát', CHO_MUON: 'Cho mượn' };

export const UNIFORM_MOVEMENT_TYPES = ['INITIAL', 'IN', 'RESERVE', 'RELEASE', 'OUT', 'ADJUSTMENT', 'RETURN', 'DISPOSE'] as const;
export type UniformMovementType = (typeof UNIFORM_MOVEMENT_TYPES)[number];
export const UNIFORM_MOVEMENT_LABELS: Record<UniformMovementType, string> = {
  INITIAL: 'Tồn đầu kỳ',
  IN: 'Nhập kho',
  RESERVE: 'Giữ chỗ',
  RELEASE: 'Trả giữ chỗ',
  OUT: 'Xuất kho (bàn giao)',
  ADJUSTMENT: 'Kiểm kê / điều chỉnh',
  RETURN: 'Nhận lại (nhân viên trả)',
  DISPOSE: 'Thanh lý / hủy',
};

/** Số lượng theo chiều tác động (như trang Lịch sử kho hiển thị). Sổ lưu số dương cho OUT / RELEASE / DISPOSE. */
export function signedUniformMovementQuantity(type: UniformMovementType, quantity: number): number {
  if (type === 'ADJUSTMENT') return quantity;
  return type === 'OUT' || type === 'RELEASE' || type === 'DISPOSE' ? -Math.abs(quantity) : Math.abs(quantity);
}

/** Lý do nhập kho đồng phục. Cả "Tồn đầu kỳ" và "Nhập bổ sung" đều cộng vào số Tồn đầu kỳ (cộng dồn) và Khả dụng. */
export const UNIFORM_STOCK_IN_REASONS = ['TON_DAU_KY', 'MUA_MOI', 'CHUYEN_KHO', 'KHAC'] as const;
export type UniformStockInReason = (typeof UNIFORM_STOCK_IN_REASONS)[number];
export const UNIFORM_STOCK_IN_REASON_LABELS: Record<UniformStockInReason, string> = {
  MUA_MOI: 'Nhập bổ sung (mua / đặt may mới)',
  TON_DAU_KY: 'Tồn đầu kỳ',
  CHUYEN_KHO: 'Chuyển kho',
  KHAC: 'Khác',
};

/** Kết quả khi nhân viên trả / thu hồi. */
export const RETURN_RESULTS = ['RESTOCK', 'DAMAGED', 'LOST'] as const;
export type ReturnResult = (typeof RETURN_RESULTS)[number];
export const RETURN_RESULT_LABELS: Record<ReturnResult, string> = {
  RESTOCK: 'Nhận lại — nhập kho',
  DAMAGED: 'Hư hỏng — không nhập kho',
  LOST: 'Mất',
};

export const RETURN_REASONS = ['TRA_MUON', 'NGHI_VIEC', 'DOI_SIZE', 'HU_HONG', 'KHAC'] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];
export const RETURN_REASON_LABELS: Record<ReturnReason, string> = {
  TRA_MUON: 'Trả đồ mượn',
  NGHI_VIEC: 'Thu hồi khi nghỉ việc',
  DOI_SIZE: 'Đổi size',
  HU_HONG: 'Hư hỏng',
  KHAC: 'Khác',
};

/** Tiêu chuẩn cấp phát / năm mặc định (Chính sách người lao động 19/08/2025 — "Số lượng đồng phục được cấp phát/1 năm: 03"). */
export const DEFAULT_YEARLY_QUOTA = 3;

/** Nhãn mặt hàng: "Áo sơmi đỏ · L · Mới". */
export function uniformSkuLabel(modelName: string, size: string, condition: UniformCondition): string {
  return [modelName, size, UNIFORM_CONDITION_LABELS[condition] ?? condition].filter(Boolean).join(' · ');
}

// ============================================================================
// Kiểu dữ liệu API
// ============================================================================

/** Tồn tổng hợp của một mẫu (cộng mọi size / tình trạng). onHand null = có mặt hàng chưa rõ tồn. */
export interface UniformModelStockSummary {
  onHand: number | null;
  reserved: number;
  available: number | null;
  newAvailable: number;
  usedAvailable: number;
  /** Số mặt hàng (size × tình trạng) đang hết / sắp hết. */
  outOfStockSkus: number;
  lowStockSkus: number;
  /** Tồn đầu kỳ cộng dồn (gồm các lần nhập bổ sung) và đã bàn giao — cộng mọi size (Apps Script cũ không trả → coi như 0). */
  received?: number;
  handedOver?: number;
}

/**
 * Số cộng dồn của một mặt hàng theo sổ biến động. Luôn khớp:
 * khả dụng = received − handedOver + returned − disposed + adjusted − đang giữ chỗ.
 */
export interface UniformStockTotals {
  /** Tồn đầu kỳ + mọi lần nhập bổ sung (không giảm khi bàn giao). */
  received: number;
  /** Đã bàn giao (phiếu đã ký). */
  handedOver: number;
  /** Nhân viên trả / thu hồi, nhập lại kho. */
  returned: number;
  /** Thanh lý / hủy. */
  disposed: number;
  /** Tổng chênh lệch kiểm kê (±). */
  adjusted: number;
}

export const EMPTY_UNIFORM_TOTALS: UniformStockTotals = { received: 0, handedOver: 0, returned: 0, disposed: 0, adjusted: 0 };

export interface UniformModel {
  modelId: string;
  modelCode: string;
  modelName: string;
  kind: UniformKind;
  gender: UniformGender;
  sizes: string[];
  unit: string;
  referencePrice: number | null;
  /** Tính vào tiêu chuẩn cấp phát năm (bảo hộ lao động thường không tính). */
  countsTowardQuota: boolean;
  /** Tồn tối thiểu MỖI size (cảnh báo sắp hết). */
  minimumStock: number;
  /** Đối tượng sử dụng (mô tả), ví dụ "NV kinh doanh nam (Showroom)". */
  appliesTo: string;
  active: boolean;
  note: string;
  createdAt: string;
  updatedAt: string;
  stock: UniformModelStockSummary;
}

/** Mặt hàng = mẫu × size × tình trạng (productId dùng trong kho, phiếu, sổ biến động). */
export interface UniformSku {
  productId: string;
  skuCode: string;
  modelId: string;
  size: string;
  condition: UniformCondition;
  active: boolean;
  stock: StockView;
  /** Có từ v2.1 (trang tồn kho); Apps Script cũ không trả → coi như 0. */
  totals?: UniformStockTotals;
}

export interface UniformStockModel extends UniformModel {
  skus: UniformSku[];
}

export interface UniformStockResponse {
  models: UniformStockModel[];
}

export interface UniformMovement {
  movementId: string;
  productId: string;
  modelId: string;
  modelName: string;
  skuCode: string;
  size: string;
  condition: UniformCondition | '';
  movementType: UniformMovementType;
  quantity: number;
  onHandBefore: number | null;
  onHandAfter: number | null;
  reservedBefore: number;
  reservedAfter: number;
  handoverId: string;
  handoverCode: string;
  employeeId: string;
  operationId: string;
  actorId: string;
  actorName: string;
  reason: string;
  createdAt: string;
}

export interface UniformMovementListResponse {
  items: UniformMovement[];
  total: number;
  page: number;
  pageSize: number;
}

/** Quy tắc tiêu chuẩn năm: nhóm (phạm vi) × mẫu ('' = tổng mọi mẫu tính tiêu chuẩn) × giới tính ('' = cả hai). */
export interface UniformNorm {
  normId: string;
  scopeId: string;
  scopeName: string;
  modelId: string;
  modelName: string;
  gender: EmployeeGender | '';
  yearlyQuantity: number;
  note: string;
  effectiveFrom: string;
  effectiveTo: string;
  active: boolean;
  /** Đang áp dụng: bật, trong thời hạn, mẫu (nếu có) còn dùng. */
  effective: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UniformDepartmentScope {
  department: string;
  employeeCount: number;
  scope: NormScope | null;
  /** '' = tự khớp theo tên / mặc định, 'NONE' = không áp dụng tiêu chuẩn, hoặc mã nhóm. */
  mapping: string;
}

export interface UniformNormsResponse {
  norms: UniformNorm[];
  scopes: NormScope[];
  departments: UniformDepartmentScope[];
  /** CAU_HINH.DP_TIEU_CHUAN_NAM — áp dụng khi nhóm của nhân viên chưa có quy tắc tổng. */
  defaultYearlyQuota: number;
}

/**
 * Mức đã dùng tiêu chuẩn năm của một nhân viên (năm dương lịch, giờ Việt Nam):
 *   issued  = dòng "Cấp phát" của mẫu tính tiêu chuẩn trong phiếu đã ký trong năm;
 *   pending = phiếu đang chờ ký / yêu cầu sửa;
 *   legacy  = đồng phục ghi tay ở phiếu loại khác (trước khi có module) đã ký trong năm — vẫn tính vào tiêu chuẩn.
 * yearlyQuota null = không áp dụng tiêu chuẩn (phòng ban chọn "Không áp dụng" hoặc tiêu chuẩn mặc định = 0).
 */
export interface UniformQuotaUsage {
  yearlyQuota: number | null;
  source: 'RULE' | 'DEFAULT' | 'NONE';
  issued: number;
  pending: number;
  legacy: number;
  remaining: number | null;
}

/** Tiêu chuẩn riêng theo mẫu (quy tắc có modelId). */
export interface UniformModelQuota {
  modelId: string;
  modelName: string;
  yearlyQuota: number;
  issued: number;
  pending: number;
  remaining: number;
}

export interface UniformEmployeeHoldingSummary {
  /** Số áo đang cho mượn chưa trả. */
  loaned: number;
  /** Số áo mượn quá hạn trả. */
  overdue: number;
  /** Tổng số áo đã nhận (cấp phát + mượn) chưa trả / thu hồi. */
  holding: number;
}

export interface UniformEmployeeRow {
  employeeId: string;
  fullName: string;
  department: string;
  position: string;
  status: 'ACTIVE' | 'INACTIVE';
  gender: EmployeeGender | '';
  uniformSize: string;
  scope: NormScope | null;
  usage: UniformQuotaUsage;
  modelQuotas: UniformModelQuota[];
  holdings: UniformEmployeeHoldingSummary;
  /** Mẫu gợi ý theo quy tắc của nhóm + giới tính (dự trù đặt may). */
  suggestedModelIds: string[];
  lastIssuedAt: string;
}

export interface UniformEmployeesResponse {
  year: number;
  employees: UniformEmployeeRow[];
  scopes: NormScope[];
  stats: {
    total: number;
    missingSize: number;
    missingGender: number;
    overQuota: number;
    withLoans: number;
    overdueLoans: number;
  };
}

/** Một dòng đồng phục nhân viên đang giữ (đã ký nhận) — cấp phát hoặc mượn. */
export interface UniformHolding {
  handoverId: string;
  handoverCode: string;
  itemId: string;
  employeeId: string;
  employeeName: string;
  department: string;
  issueKind: IssueKind;
  modelId: string;
  modelName: string;
  productId: string;
  skuCode: string;
  size: string;
  condition: UniformCondition | '';
  quantity: number;
  /** Đã trả / thu hồi / báo hư hỏng / mất (mọi kết quả). */
  returned: number;
  outstanding: number;
  dueDate: string;
  overdue: boolean;
  confirmedAt: string;
}

export interface UniformHoldingsResponse {
  items: UniformHolding[];
  total: number;
  stats: { loans: number; overdue: number; dueSoon: number; issued: number };
}

export interface UniformReturnRecord {
  returnId: string;
  handoverId: string;
  handoverCode: string;
  itemId: string;
  employeeId: string;
  employeeName: string;
  productId: string;
  modelName: string;
  size: string;
  quantity: number;
  result: ReturnResult;
  restockProductId: string;
  restockCondition: UniformCondition | '';
  reason: ReturnReason;
  note: string;
  actorName: string;
  createdAt: string;
}

/** Đồng phục ghi tay ở phiếu loại khác (trước khi có module) — chỉ để xem lịch sử, không sửa được. */
export interface UniformLegacyItem {
  handoverId: string;
  handoverCode: string;
  category: string;
  itemName: string;
  quantity: number | null;
  description: string;
  confirmedAt: string;
}

export interface UniformIssueHistoryEntry {
  handoverId: string;
  handoverCode: string;
  status: string;
  createdAt: string;
  confirmedAt: string;
  lines: Array<{ modelName: string; size: string; condition: UniformCondition | ''; quantity: number; issueKind: IssueKind; dueDate: string }>;
}

export interface UniformEmployeeDetail {
  year: number;
  employee: UniformEmployeeRow;
  holdings: UniformHolding[];
  returns: UniformReturnRecord[];
  issues: UniformIssueHistoryEntry[];
  legacyItems: UniformLegacyItem[];
}

export interface UniformHandoverContextSku extends UniformSku {
  /** Số đang giữ chỗ cho CHÍNH phiếu đang sửa (được tính là khả dụng khi sửa phiếu). */
  reservedByThisHandover: number;
}

export interface UniformHandoverContextModel extends UniformModel {
  skus: UniformHandoverContextSku[];
  /** Mẫu thuộc gợi ý của nhóm người nhận (quy tắc tiêu chuẩn). */
  suggested: boolean;
}

export interface UniformHandoverContext {
  receiver: {
    employeeId: string;
    fullName: string;
    department: string;
    position: string;
    gender: EmployeeGender | '';
    uniformSize: string;
  } | null;
  scope: NormScope | null;
  year: number;
  usage: UniformQuotaUsage | null;
  modelQuotas: UniformModelQuota[];
  models: UniformHandoverContextModel[];
}

export interface UniformStockAlert {
  productId: string;
  modelId: string;
  modelName: string;
  size: string;
  condition: UniformCondition;
  available: number | null;
  minimumStock: number;
  status: StockStatus;
}

export interface UniformDashboard {
  year: number;
  counts: {
    models: number;
    onHand: number;
    reserved: number;
    available: number;
    outOfStockSkus: number;
    lowStockSkus: number;
    unknownStockSkus: number;
    pendingHandovers: number;
    loansOutstanding: number;
    loansOverdue: number;
    employeesMissingSize: number;
    employeesMissingGender: number;
    issuedThisYear: number;
    overQuotaEmployees: number;
    /** Tồn đầu kỳ cộng dồn (gồm nhập bổ sung) / đã bàn giao — mọi mẫu (Apps Script cũ không trả). */
    received?: number;
    handedOver?: number;
  };
  alerts: UniformStockAlert[];
  overdueLoans: UniformHolding[];
  recentIssues: Array<{
    handoverId: string;
    handoverCode: string;
    receiverName: string;
    department: string;
    quantity: number;
    status: string;
    createdAt: string;
  }>;
}

/** Kết quả ghi nhận trả / thu hồi. */
export interface UniformReturnResult {
  record: UniformReturnRecord;
  duplicate: boolean;
  holding: UniformHolding;
}
