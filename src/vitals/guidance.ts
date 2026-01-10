import type { ReasonCode } from './reasons';

export function reasonsToGuidanceVi(reasons: ReasonCode[]): string[] {
    const out: string[] = [];
    if (reasons.includes('FACE_LOST')) out.push('Đưa mặt vào khung hình và giữ ổn định.');
    if (reasons.includes('LOW_LIGHT')) out.push('Tăng ánh sáng phía trước mặt (đèn/ánh sáng màn hình 1 chút).');
    if (reasons.includes('MOTION_HIGH')) out.push('Giữ đầu ổn định ~5–10 giây để đo chính xác.');
    if (reasons.includes('FPS_UNSTABLE')) out.push('Đóng app nền / giảm chất lượng camera để ổn định khung hình.');
    if (reasons.includes('SATURATION')) out.push('Giảm nguồn sáng quá gắt (tránh bị cháy sáng).');
    if (reasons.includes('INSUFFICIENT_WINDOW')) out.push('Giữ nguyên tư thế thêm một lúc để đủ dữ liệu.');
    if (reasons.includes('SNR_LOW')) out.push('Tiến gần camera hơn và tránh rung/lóa sáng.');
    return out;
}
