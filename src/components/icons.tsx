// 线性 SVG 图标（strokeWidth 统一 1.75），替代 emoji，避免 AI slop。
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...rest,
  };
}

/** 闸门/盾牌：品牌标识 */
export function IconGate(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9 12h6M12 9v6" />
    </svg>
  );
}

/** 机器人：管家 */
export function IconBot(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="4" y="8" width="16" height="11" rx="2" />
      <path d="M12 8V4M9 13h.01M15 13h.01M9 16h6" />
      <path d="M2 12v3M22 12v3" />
    </svg>
  );
}

/** 实心圆点：在线状态（用 fill） */
export function IconDot({ size = 9, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...rest}>
      <circle cx="12" cy="12" r="9" fill="currentColor" />
    </svg>
  );
}

/** 空心圆点：离线状态 */
export function IconDotOff({ size = 9, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      {...rest}
    >
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

/** 云：云端模型 */
export function IconCloud(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6.5 18a4 4 0 010-8 5 5 0 019.6-1.2A3.8 3.8 0 0118 18H6.5z" />
    </svg>
  );
}

/** 警示三角 */
export function IconAlert(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3.5L21 19H3L12 3.5z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  );
}

/** 对勾 */
export function IconCheck(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
}

/** 叉 */
export function IconClose(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** 锁/隐私：数据安全 */
export function IconLock(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
      <circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
