'use client';

type UserAvatarProps = {
  name: string;
  src?: string;
  className?: string;
};

export default function UserAvatar({ name, src, className = 'h-9 w-9' }: UserAvatarProps) {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'NV';

  return (
    <span
      aria-hidden="true"
      className={`${className} shrink-0 overflow-hidden rounded-full bg-primary/15 text-primary ring-1 ring-border flex items-center justify-center bg-cover bg-center text-xs font-bold`}
      style={src ? { backgroundImage: `url(${JSON.stringify(src).slice(1, -1)})` } : undefined}
    >
      {!src && initials}
    </span>
  );
}
