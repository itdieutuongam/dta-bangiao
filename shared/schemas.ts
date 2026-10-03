import { z } from 'zod';
import { CATEGORY_CODE_PATTERN, HANDOVER_STATUSES, ITEM_FIELD_META, LIMITS } from './constants';
import { containsPasswordLike, isHttpUrl, isValidDateOnly, stripControlChars } from './text';

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

const TEXT_ITEM_KEYS = [
  'itemName',
  'assetCode',
  'serialNumber',
  'model',
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
    condition: singleLine(ITEM_FIELD_META.condition.max).default(''),
    description: multiLine(ITEM_FIELD_META.description.max).default(''),
    workStatus: singleLine(ITEM_FIELD_META.workStatus.max).default(''),
    deadline: z
      .string({ error: INVALID_TEXT })
      .trim()
      .refine((v) => v === '' || isValidDateOnly(v), 'Ngày không hợp lệ')
      .default(''),
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

export const handoverInputSchema = z
  .object({
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
      .min(1, 'Cần ít nhất 1 nội dung bàn giao')
      .max(LIMITS.maxItems, `Tối đa ${LIMITS.maxItems} nội dung trong một biên bản`),
  })
  .superRefine((value, ctx) => {
    if (value.sender.employeeId && value.sender.employeeId === value.receiverEmployeeId) {
      ctx.addIssue({ code: 'custom', path: ['receiverEmployeeId'], message: 'Người nhận phải khác người bàn giao' });
    }
    if (containsPasswordLike(value.note)) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: PASSWORD_FORBIDDEN_MESSAGE });
    }
  });

export type HandoverInputParsed = z.output<typeof handoverInputSchema>;

/** Base64 của PNG tối đa signatureMaxBytes → chuỗi data URL tối đa ~4/3 kích thước. */
const SIGNATURE_DATA_URL_MAX = Math.ceil((LIMITS.signatureMaxBytes * 4) / 3) + 64;

export const confirmSchema = z.object({
  agreed: z.literal(true, { error: 'Bạn cần tích xác nhận đã kiểm tra và nhận đủ các nội dung bàn giao' }),
  signature: z
    .string({ error: 'Vui lòng ký tên trước khi xác nhận' })
    .max(SIGNATURE_DATA_URL_MAX, 'Ảnh chữ ký quá lớn')
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/, 'Dữ liệu chữ ký không hợp lệ'),
  comment: multiLine(LIMITS.receiverComment).default(''),
});

export const revisionSchema = z.object({
  reason: multiLine(LIMITS.receiverComment).min(
    LIMITS.revisionReasonMin,
    `Vui lòng nhập lý do / nội dung cần sửa (ít nhất ${LIMITS.revisionReasonMin} ký tự)`,
  ),
});

export const cancelSchema = z.object({
  reason: multiLine(LIMITS.cancelReason).default(''),
});

export const adminLoginSchema = z.object({
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
  status: z.union([z.enum(HANDOVER_STATUSES), z.literal('')]).catch(''),
  from: optionalDate,
  to: optionalDate,
});

export type AdminListQuery = z.output<typeof adminListQuerySchema>;

/** Gom lỗi Zod thành map "đường dẫn field" → thông báo đầu tiên. */
export function toFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.map(String).join('.') || '_';
    if (!(path in out)) out[path] = issue.message;
  }
  return out;
}
