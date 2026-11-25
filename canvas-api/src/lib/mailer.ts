/**
 * 开发期占位邮件器：不接入真实投递（PRD 明确本期不做邮件真实投递）。
 * 令牌也会通过接口在 AUTO_VERIFY_EMAIL=false 时返回，便于联调。
 */
function log(kind: string, to: string, token: string): void {
    console.log(`[mail] ${kind} -> ${to} token=${token}`);
}

export function sendVerificationEmail(to: string, token: string): void {
    log('verify-email', to, token);
}

export function sendPasswordResetEmail(to: string, token: string): void {
    log('reset-password', to, token);
}
