import { z } from 'zod';
import {
  CATEGORY_CODE_PATTERN,
  HANDOVER_STATUSES,
  HANDOVER_TYPES,
  ITEM_FIELD_META,
  LIMITS,
  UUID_PATTERN,
} from './constants';
import { containsPasswordLike, isHttpUrl, isValidDateOnly, stripControlChars } from './text';
import { CATALOG_STATUSES, MOVEMENT_TYPES, PROPOSAL_STATUSES, STOCK_IN_REASONS, STOCK_STATUSES } from './vpp';

export const PASSWORD_FORBIDDEN_MESSAGE =
  'Không được ghi mật khẩu vào biên bản. Hãy bàn giao mật khẩu trực tiếp hoặc yêu cầu người nhận tự đặt lại.';

const INVALID_TEXT = 'Giá trị phải là chuỗi ký tự';

/** Chuỗi một dòng: bỏ ký tự điều khiển, gộp khoảng trắng, trim, giới hạn độ dài. */
export function singleLine(max: number) {
  return z
    .string({ error: INVALID_TEXT })
    .overwrite((v) => stripControlChars(v).replace(/\s+/g, ' ').trim())
    .max(max, `Tối đa ${max} ký tự`);
}

/** Chuỗi nhiều dòng: chuẩn hóa xuống dòng, trim, giới hạn độ dài. */
export function multiLine(max: number) {
  return z
    .string({ error: INVALID_TEXT })
    .overwrite((v) => stripControlChars(v).replace(/\r\n?/g, '\n').trim())
    .max(max, `Tối đa ${max} ký tự`);
}

const uuid = (message: string) => z.string({ error: message }).trim().toLowerCase().regex(UUID_PATTERN, message);

/** Số nguyên trong khoảng. */
const intIn = (min: number, max: number, message: string) =>
  z.number({ error: message }).int(message).min(min, message).max(max, message);

/** Đơn giá: số ≥ 0 hoặc null (bỏ trống). */
const optionalPrice = z
  .number({ error: 'Đơn giá phải là số' })
  .min(0, 'Đơn giá không hợp lệ')
  .max(LIMITS.maxPrice, 'Đơn giá không hợp lệ')
  .nullable()
  .default(null);

const optionalDateOnly = z
  .string({ error: INVALID_TEXT })
  .trim()
  .refine((v) => v === '' || isValidDateOnly(v), 'Ngày không hợp lệ')
  .default('');

const TEXT_ITEM_KEYS = [
  'itemName',
  'assetCode',
  'serialNumber',
  'model',
  'unit',
  'condition',
  'description',
  'workStatus',
  'note',
] as const;

export const handoverItemSchema = z
  .object({
    category: z.string({ error: 'Chọn loại bàn giao' }).trim().regex(CATEGORY_CODE_PATTERN, 'Loại bàn giao không hợp lệ'),
    itemName: singleLine(ITEM_FIELD_META.itemName.max).default(''),
    assetCode: singleLine(ITEM_FIELD_META.assetCode.max).default(''),
    serialNumber: singleLine(ITEM_FIELD_META.serialNumber.max).default(''),
    model: singleLine(ITEM_FIELD_META.model.max).default(''),
    quantity: z
      .number({ error: 'Số lượng phải là số' })
      .int('Số lượng phải là số nguyên')
      .min(1, 'Số lượng tối thiểu là 1')
      .max(LIMITS.maxQuantity, `Số lượng tối đa ${LIMITS.maxQuantity}`)
      .nullable()
      .default(null),
    unit: singleLine(ITEM_FIELD_META.unit.max).default(''),
    condition: singleLine(ITEM_FIELD_META.condition.max).default(''),
    description: multiLine(ITEM_FIELD_META.description.max).default(''),
    workStatus: singleLine(ITEM_FIELD_META.workStatus.max).default(''),
    deadline: optionalDateOnly,
    documentUrl: singleLine(ITEM_FIELD_META.documentUrl.max)
      .refine((v) => v === '' || isHttpUrl(v), 'Link phải bắt đầu bằng http:// hoặc https://')
      .default(''),
    note: multiLine(ITEM_FIELD_META.note.max).default(''),
  })
  .superRefine((item, ctx) => {
    if (!item.itemName && !item.description) {
      ctx.addIssue({ code: 'custom', path: ['itemName'], message: 'Nhập tên hoặc nội dung bàn giao' });
    }
    for (const key of TEXT_ITEM_KEYS) {
      if (containsPasswordLike(item[key])) {
        ctx.addIssue({ code: 'custom', path: [key], message: PASSWORD_FORBIDDEN_MESSAGE });
      }
    }
  });

/** Một dòng văn phòng phẩm (phiếu OFFICE_SUPPLY): sản phẩm trong kho + số lượng. */
export const supplyLineSchema = z
  .object({
    productId: uuid('Chọn văn phòng phẩm'),
    quantity: intIn(1, LIMITS.maxQuantity, `Số lượng phải là số nguyên từ 1 đến ${LIMITS.maxQuantity}`),
    note: multiLine(ITEM_FIELD_META.note.max).default(''),
    overNormReason: multiLine(LIMITS.overNormReason).default(''),
  })
  .superRefine((line, ctx) => {
    if (containsPasswordLike(line.note)) ctx.addIssue({ code: 'custom', path: ['note'], message: PASSWORD_FORBIDDEN_MESSAGE });
  });

export const handoverInputSchema = z
  .object({
    handoverType: z.enum(HANDOVER_TYPES, { error: 'Chọn loại phiếu bàn giao' }),
    clientRequestId: z.string().trim().toLowerCase().regex(UUID_PATTERN).optional(),
    sender: z.object(
      {
        name: singleLine(LIMITS.personName).min(1, 'Nhập hoặc chọn người bàn giao'),
        employeeId: singleLine(LIMITS.employeeId).default(''),
      },
      { error: 'Thiếu thông tin người bàn giao' },
    ),
    receiverEmployeeId: singleLine(LIMITS.employeeId).min(1, 'Chọn người nhận từ danh sách nhân viên'),
    note: multiLine(LIMITS.handoverNote).default(''),
    items: z
      .array(handoverItemSchema, { error: 'Danh sách nội dung không hợp lệ' })
      .max(LIMITS.maxItems, `Tối đa ${LIMITS.maxItems} nội dung trong một biên bản`)
      .default([]),
    supplies: z
      .array(supplyLineSchema, { error: 'Danh sách văn phòng phẩm không hợp lệ' })
      .max(LIMITS.maxItems, `Tối đa ${LIMITS.maxItems} sản phẩm trong một phiếu`)
      .default([]),
  })
  .superRefine((value, ctx) => {
    if (value.sender.employeeId && value.sender.employeeId === value.receiverEmployeeId) {
      ctx.addIssue({ code: 'custom', path: ['receiverEmployeeId'], message: 'Người nhận phải khác người bàn giao' });
    }
    if (containsPasswordLike(value.note)) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: PASSWORD_FORBIDDEN_MESSAGE });
    }
    if (value.handoverType === 'OFFICE_SUPPLY') {
      if (value.items.length) {
        ctx.addIssue({ code: 'custom', path: ['items'], message: 'Phiếu văn phòng phẩm chỉ gồm sản phẩm chọn từ kho.' });
      }
      if (!value.supplies.length) ctx.addIssue({ code: 'custom', path: ['supplies'], message: 'Chọn ít nhất 1 văn phòng phẩm' });
      const seen = new Set<string>();
      value.supplies.forEach((line, i) => {
        if (seen.has(line.productId)) {
          ctx.addIssue({ code: 'custom', path: ['supplies', i, 'productId'], message: 'Sản phẩm bị trùng — hãy gộp số lượng vào một dòng' });
        }
        seen.add(line.productId);
      });
    } else {
      if (value.supplies.length) {
        ctx.addIssue({ code: 'custom', path: ['supplies'], message: 'Chỉ phiếu Văn phòng phẩm mới chọn sản phẩm trong kho.' });
      }
      if (!value.items.length) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Cần ít nhất 1 nội dung bàn giao' });
    }
  });

export type HandoverInputParsed = z.output<typeof handoverInputSchema>;

/** Base64 của PNG tối đa signatureMaxBytes → chuỗi data URL tối đa ~4/3 kích thước. */
const SIGNATURE_DATA_URL_MAX = Math.ceil((LIMITS.signatureMaxBytes * 4) / 3) + 64;

const contentHash = z
  .string({ error: 'Trang biên bản đã cũ — vui lòng tải lại trang.' })
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{64}$/, 'Trang biên bản đã cũ — vui lòng tải lại trang.');

export const confirmSchema = z.object({
  agreed: z.literal(true, { error: 'Bạn cần tích xác nhận đã kiểm tra và nhận đủ các nội dung bàn giao' }),
  contentHash,
  signature: z
    .string({ error: 'Vui lòng ký tên trước khi xác nhận' })
    .max(SIGNATURE_DATA_URL_MAX, 'Ảnh chữ ký quá lớn')
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/, 'Dữ liệu chữ ký không hợp lệ'),
  comment: multiLine(LIMITS.receiverComment).default(''),
  /** Mã xác nhận 6 số gửi tới email người nhận (bắt buộc khi biên bản yêu cầu — Apps Script kiểm tra). */
  otp: z
    .string({ error: 'Mã xác nhận không hợp lệ' })
    .trim()
    .regex(/^(\d{6})?$/, 'Mã xác nhận gồm 6 chữ số')
    .default(''),
});

/**
 * Thông tin kèm khi quản trị viên lưu bản sửa (PUT /api/admin/handovers/:id), ngoài nội dung phiếu (handoverInputSchema):
 * expectedContentHash = mã băm nội dung lúc mở trang sửa → phiếu đã bị người khác sửa trong lúc đó thì báo CONFLICT
 * thay vì âm thầm ghi đè.
 */
export const handoverUpdateMetaSchema = z.object({
  expectedContentHash: z
    .string({ error: 'Trang sửa biên bản đã cũ — vui lòng tải lại trang.' })
    .trim()
    .toLowerCase()
    .regex(/^[0-9a-f]{64}$/, 'Trang sửa biên bản đã cũ — vui lòng tải lại trang.')
    .optional(),
});

export const revisionSchema = z.object({
  contentHash,
  reason: multiLine(LIMITS.receiverComment).min(
    LIMITS.revisionReasonMin,
    `Vui lòng nhập lý do / nội dung cần sửa (ít nhất ${LIMITS.revisionReasonMin} ký tự)`,
  ),
});

export const cancelSchema = z.object({
  reason: multiLine(LIMITS.cancelReason).default(''),
});

export const adminLoginSchema = z.object({
  username: z.string({ error: 'Tên đăng nhập không hợp lệ' }).trim().toLowerCase().max(60, 'Tên đăng nhập quá dài').default(''),
  password: z.string({ error: 'Nhập mật khẩu' }).min(1, 'Nhập mật khẩu').max(256, 'Mật khẩu quá dài'),
});

export const staffLoginSchema = z.object({
  code: z.string({ error: 'Nhập mã truy cập' }).min(1, 'Nhập mã truy cập').max(256, 'Mã truy cập quá dài'),
});

const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === '' || isValidDateOnly(v))
  .catch('');

/** Bộ lọc danh sách admin (query string). Giá trị không hợp lệ bị bỏ qua thay vì báo lỗi. */
export const adminListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  pageSize: z.coerce.number().int().min(5).max(100).catch(20),
  code: singleLine(60).catch(''),
  employeeName: singleLine(LIMITS.personName).catch(''),
  employeeId: singleLine(LIMITS.employeeId).catch(''),
  sender: singleLine(LIMITS.personName).catch(''),
  receiver: singleLine(LIMITS.personName).catch(''),
  department: singleLine(120).catch(''),
  category: z.union([z.string().regex(CATEGORY_CODE_PATTERN), z.literal('')]).catch(''),
  handoverType: z.union([z.enum(HANDOVER_TYPES), z.literal('')]).catch(''),
  status: z.union([z.enum(HANDOVER_STATUSES), z.literal('')]).catch(''),
  from: optionalDate,
  to: optionalDate,
});

export type AdminListQuery = z.output<typeof adminListQuerySchema>;

// ============================================================================
// Văn phòng phẩm — quản trị
// ============================================================================

const productFields = {
  productCode: z
    .string({ error: INVALID_TEXT })
    .trim()
    .toUpperCase()
    .refine((v) => v === '' || /^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(v), 'Mã chỉ gồm chữ, số, . _ - (tối đa 40 ký tự)')
    .default(''),
  productName: singleLine(LIMITS.productName).min(1, 'Nhập tên sản phẩm'),
  category: singleLine(LIMITS.productCategory).default(''),
  unit: singleLine(LIMITS.unit).default(''),
  referencePrice: optionalPrice,
  minimumStock: intIn(0, LIMITS.maxQuantity, 'Tồn tối thiểu phải là số nguyên ≥ 0').default(0),
  note: multiLine(1000).default(''),
};

export const productSaveSchema = z.object({
  ...productFields,
  catalogStatus: z.enum(CATALOG_STATUSES).optional(),
  active: z.boolean().default(true),
  /** Chỉ dùng khi TẠO: gửi lại cùng mã (mạng chập chờn, bấm lại) → trả sản phẩm đã tạo, không tạo trùng. */
  clientRequestId: z.string().trim().toLowerCase().regex(UUID_PATTERN, 'Mã thao tác không hợp lệ').optional(),
});

const normScopeRef = z.object({
  scopeId: z.string().trim().toUpperCase().default(''),
  scopeName: singleLine(120).default(''),
  monthlyQuantity: intIn(0, LIMITS.maxQuantity, 'Định mức phải là số nguyên ≥ 0'),
  note: multiLine(1000).default(''),
});

export const normSaveSchema = z
  .object({
    productId: uuid('Chọn sản phẩm'),
    scopeId: z.string().trim().toUpperCase().default(''),
    scopeName: singleLine(120).default(''),
    monthlyQuantity: intIn(0, LIMITS.maxQuantity, 'Định mức phải là số nguyên ≥ 0'),
    unit: singleLine(LIMITS.unit).default(''),
    referencePrice: optionalPrice,
    note: multiLine(1000).default(''),
    effectiveFrom: optionalDateOnly,
    effectiveTo: optionalDateOnly,
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (!v.scopeId && !v.scopeName) {
      ctx.addIssue({ code: 'custom', path: ['scopeId'], message: 'Chọn phạm vi định mức hoặc nhập tên phạm vi mới' });
    }
    if (v.effectiveFrom && v.effectiveTo && v.effectiveTo < v.effectiveFrom) {
      ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'Ngày kết thúc phải sau ngày bắt đầu' });
    }
  });

export const scopeMappingSchema = z.object({
  department: singleLine(120).min(1, 'Thiếu phòng ban'),
  scopeId: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === '' || v === 'NONE' || /^[A-Z0-9_]{1,40}$/.test(v), 'Phạm vi không hợp lệ')
    .default(''),
});

const clientRequestId = z.string({ error: 'Thiếu mã thao tác' }).trim().toLowerCase().regex(UUID_PATTERN, 'Thiếu mã thao tác');

export const stockInSchema = z
  .object({
    productId: uuid('Chọn sản phẩm'),
    quantity: intIn(1, LIMITS.maxQuantity, 'Số lượng phải là số nguyên ≥ 1'),
    reasonType: z.enum(STOCK_IN_REASONS, { error: 'Chọn lý do nhập kho' }),
    unitPrice: optionalPrice,
    date: optionalDateOnly,
    note: multiLine(LIMITS.stockReason).default(''),
    clientRequestId,
  })
  .superRefine((v, ctx) => {
    if (v.reasonType === 'KHAC' && !v.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Nhập ghi chú cho lý do "Khác"' });
  });

export const stockAdjustSchema = z.object({
  productId: uuid('Chọn sản phẩm'),
  countedQuantity: intIn(0, LIMITS.maxQuantity, 'Tồn kiểm kê phải là số nguyên ≥ 0'),
  reason: multiLine(LIMITS.stockReason).min(3, 'Nhập lý do điều chỉnh / kiểm kê'),
  clientRequestId,
});

export const proposalReviewSchema = z.object({
  decisions: z
    .array(
      z.object({
        proposalItemId: uuid('Thiếu dòng đề xuất'),
        approvedQuantity: intIn(0, LIMITS.maxQuantity, 'Số lượng duyệt phải là số nguyên ≥ 0'),
        approvedPrice: optionalPrice,
      }),
    )
    .min(1, 'Thiếu quyết định duyệt')
    .max(LIMITS.maxItems),
  adminNote: multiLine(LIMITS.proposalReason).default(''),
});

export const proposalRejectSchema = z.object({
  reason: multiLine(LIMITS.proposalReason).min(3, 'Nhập lý do từ chối'),
});

export const proposalNoteSchema = z.object({
  note: multiLine(LIMITS.proposalReason).default(''),
});

export const proposalReceiveSchema = z.object({
  lines: z
    .array(
      z.object({
        proposalItemId: uuid('Thiếu dòng đề xuất'),
        receivedQuantity: intIn(0, LIMITS.maxQuantity, 'Số lượng thực nhận phải là số nguyên ≥ 0'),
        unitPrice: optionalPrice,
      }),
    )
    .min(1, 'Nhập số lượng thực nhận')
    .max(LIMITS.maxItems),
  receivedDate: optionalDateOnly,
  note: multiLine(LIMITS.stockReason).default(''),
});

export const productDecisionSchema = z
  .object({
    decision: z.enum(['MASTER', 'TEMP', 'REJECT', 'MAP'], { error: 'Chọn cách xử lý sản phẩm' }),
    productCode: productFields.productCode,
    productName: singleLine(LIMITS.productName).default(''),
    category: productFields.category,
    unit: productFields.unit,
    referencePrice: optionalPrice,
    minimumStock: productFields.minimumStock,
    note: productFields.note,
    targetProductId: z.string().trim().toLowerCase().default(''),
    norm: normScopeRef.nullable().default(null),
    /**
     * ĐVT của dòng đổi sang ĐVT khác (MAP sang sản phẩm khác ĐVT; MASTER / TEMP với ĐVT khác ĐVT đề xuất; hoặc dòng đề xuất chưa có
     * ĐVT): số lượng đề xuất đã quy đổi sang ĐVT mới + xác nhận đã quy đổi (Apps Script bắt buộc — giống GHÉP ở trang Rà soát dữ liệu).
     */
    convertedQuantity: intIn(1, LIMITS.maxQuantity, 'Số lượng quy đổi phải là số nguyên ≥ 1').nullable().default(null),
    unitConverted: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if ((v.decision === 'MASTER' || v.decision === 'TEMP') && !v.productName) {
      ctx.addIssue({ code: 'custom', path: ['productName'], message: 'Nhập tên sản phẩm' });
    }
    if (v.decision === 'MASTER' && !v.unit) ctx.addIssue({ code: 'custom', path: ['unit'], message: 'Nhập ĐVT cho sản phẩm danh mục' });
    if (v.decision === 'MAP' && !UUID_PATTERN.test(v.targetProductId)) {
      ctx.addIssue({ code: 'custom', path: ['targetProductId'], message: 'Chọn sản phẩm có sẵn để ghép' });
    }
  });

export const mergeProductSchema = z
  .object({
    sourceProductId: uuid('Thiếu sản phẩm nguồn'),
    targetProductId: uuid('Chọn sản phẩm danh mục để ghép'),
    quantity: intIn(0, LIMITS.maxQuantity, 'Số lượng phải là số nguyên ≥ 0').nullable().default(null),
    /** Người dùng xác nhận số lượng đã quy đổi sang ĐVT của sản phẩm đích (bắt buộc khi ĐVT khác nhau / nguồn chưa có ĐVT). */
    unitConverted: z.boolean().default(false),
    reason: multiLine(LIMITS.stockReason).default(''),
  })
  .refine((v) => v.sourceProductId !== v.targetProductId, { path: ['targetProductId'], message: 'Chọn sản phẩm đích khác sản phẩm nguồn' });

/** Đồng bộ số tồn của một sản phẩm theo sổ biến động. */
export const syncStockSchema = z.object({ productId: uuid('Thiếu sản phẩm') });

export const promoteProductSchema = z.object({
  productId: uuid('Thiếu sản phẩm'),
  ...productFields,
  unit: singleLine(LIMITS.unit).min(1, 'Nhập ĐVT cho sản phẩm danh mục'),
  norm: normScopeRef.nullable().default(null),
});

export const skipReviewSchema = z.object({ productId: uuid('Thiếu sản phẩm') });

export const productListQuerySchema = z.object({
  q: singleLine(120).catch(''),
  stockStatus: z.union([z.enum(STOCK_STATUSES), z.literal('')]).catch(''),
  catalogStatus: z.union([z.enum(CATALOG_STATUSES), z.literal('')]).catch(''),
  includeArchived: z
    .enum(['true', 'false', ''])
    .catch('')
    .transform((v) => v === 'true'),
});

export const movementListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  pageSize: z.coerce.number().int().min(10).max(200).catch(50),
  productId: z.string().trim().toLowerCase().regex(UUID_PATTERN).or(z.literal('')).catch(''),
  type: z.union([z.enum(MOVEMENT_TYPES), z.literal('')]).catch(''),
  from: optionalDate,
  to: optionalDate,
  q: singleLine(120).catch(''),
});

export const proposalListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  pageSize: z.coerce.number().int().min(5).max(100).catch(20),
  status: z.union([z.enum(PROPOSAL_STATUSES), z.literal('')]).catch(''),
  q: singleLine(120).catch(''),
});

export const handoverContextQuerySchema = z.object({
  receiverEmployeeId: singleLine(LIMITS.employeeId).catch(''),
  handoverId: z.string().trim().toLowerCase().regex(UUID_PATTERN).or(z.literal('')).catch(''),
});

// ============================================================================
// Văn phòng phẩm — công khai (trang /de-xuat-vpp)
// ============================================================================

export const employeeLookupSchema = z.object({
  employeeId: singleLine(LIMITS.employeeId).min(1, 'Nhập mã nhân viên'),
});

export const proposalItemInputSchema = z
  .object({
    productId: z.string().trim().toLowerCase().default(''),
    productName: singleLine(LIMITS.productName).default(''),
    unit: singleLine(LIMITS.unit).default(''),
    quantity: intIn(1, LIMITS.maxQuantity, 'Số lượng phải là số nguyên ≥ 1'),
    reason: multiLine(LIMITS.proposalItemText).default(''),
    referenceUrl: singleLine(LIMITS.url)
      .refine((v) => v === '' || isHttpUrl(v), 'Link phải bắt đầu bằng http:// hoặc https://')
      .default(''),
    note: multiLine(LIMITS.proposalItemText).default(''),
  })
  .superRefine((v, ctx) => {
    if (v.productId && !UUID_PATTERN.test(v.productId)) {
      ctx.addIssue({ code: 'custom', path: ['productId'], message: 'Sản phẩm không hợp lệ' });
    }
    if (!v.productId && !v.productName) ctx.addIssue({ code: 'custom', path: ['productName'], message: 'Nhập tên sản phẩm' });
    if (containsPasswordLike(v.note) || containsPasswordLike(v.reason)) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: PASSWORD_FORBIDDEN_MESSAGE });
    }
  });

export const proposalSubmitSchema = z.object({
  employeeId: singleLine(LIMITS.employeeId).min(1, 'Nhập mã nhân viên'),
  reason: multiLine(LIMITS.proposalReason).default(''),
  items: z
    .array(proposalItemInputSchema, { error: 'Danh sách sản phẩm không hợp lệ' })
    .min(1, 'Chọn ít nhất 1 sản phẩm cần đề xuất')
    .max(LIMITS.maxItems, `Tối đa ${LIMITS.maxItems} sản phẩm trong một đề xuất`),
  clientRequestId: z.string().trim().toLowerCase().regex(UUID_PATTERN).optional(),
});

/** Gom lỗi Zod thành map "đường dẫn field" → thông báo đầu tiên. */
export function toFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.map(String).join('.') || '_';
    if (!(path in out)) out[path] = issue.message;
  }
  return out;
}
