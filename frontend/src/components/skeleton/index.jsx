import React, { useEffect, useRef, useState } from 'react';

export function useMinimumLoading(isLoading, minimumMs = 2000) {
  const startedAt = useRef(isLoading ? Date.now() : null);
  const wasLoading = useRef(Boolean(isLoading));
  const [visible, setVisible] = useState(Boolean(isLoading));
  useEffect(() => {
    if (isLoading) {
      if (!wasLoading.current || startedAt.current == null) startedAt.current = Date.now();
      wasLoading.current = true;
      setVisible(true);
      return undefined;
    }
    wasLoading.current = false;
    if (startedAt.current == null) return undefined;
    const remaining = Math.max(0, startedAt.current + minimumMs - Date.now());
    const timer = window.setTimeout(() => {
      startedAt.current = null;
      setVisible(false);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [isLoading, minimumMs]);
  return Boolean(isLoading || visible);
}

export function Skeleton({ width, height, radius = '0.5rem', className = '', style = {} }) {
  return <span aria-hidden="true" className={`mz-skeleton ${className}`} style={{ width, height, borderRadius: radius, ...style }} />;
}

export function SkeletonText({ lines = 3, className = '' }) {
  return <span aria-hidden="true" className={`mz-skeleton-text ${className}`}>{Array.from({ length: lines }, (_, i) => <Skeleton key={i} height="0.8em" className={i === lines - 1 ? 'mz-skeleton-short' : ''} />)}</span>;
}

export function SkeletonAvatar({ size = 44 }) { return <Skeleton width={size} height={size} radius="50%" />; }

export function SkeletonCard({ className = '' }) {
  return <div className={`mz-skeleton-card ${className}`}><Skeleton height="1.25rem" width="42%" /><SkeletonText lines={3} /><Skeleton height="7rem" /></div>;
}

export function SkeletonTable({ rows = 5, columns = 4, className = '' }) {
  return <div className={`mz-skeleton-table ${className}`} aria-hidden="true">{Array.from({ length: rows + 1 }, (_, row) => <div className="mz-skeleton-row" key={row}>{Array.from({ length: columns }, (_, col) => <Skeleton key={col} height={row ? '1rem' : '1.25rem'} style={{ flex: col === 0 ? 1.5 : 1 }} />)}</div>)}</div>;
}

export function SkeletonList({ rows = 4, className = '' }) {
  return <div className={`mz-skeleton-list ${className}`} aria-hidden="true">{Array.from({ length: rows }, (_, i) => <div className="mz-skeleton-list-row" key={i}><SkeletonAvatar /><SkeletonText lines={2} /></div>)}</div>;
}

export function SkeletonBoard({ size = 'min(100%, 420px)' }) { return <Skeleton width={size} height={size} radius="0" className="mz-skeleton-board" />; }
export function SkeletonChart({ height = 220 }) { return <Skeleton height={height} className="mz-skeleton-chart" />; }
export function SkeletonStatCard() { return <div className="mz-skeleton-stat"><Skeleton width={36} height={36} radius="50%" /><Skeleton width="55%" height="0.8rem" /><Skeleton width="70%" height="1.7rem" /></div>; }

export function SkeletonRegion({ children, label = 'Loading content', className = '' }) {
  return <div className={className} aria-busy="true" aria-label={label} role="status">{children}</div>;
}

export function SkeletonBoundary({ isLoading, fallback, children, minimumMs = 2000, label = 'Loading content', className = '' }) {
  const showSkeleton = useMinimumLoading(isLoading, minimumMs);
  const [showFallback, setShowFallback] = useState(Boolean(isLoading));
  const [exiting, setExiting] = useState(false);
  useEffect(() => {
    if (showSkeleton) {
      setShowFallback(true);
      setExiting(false);
      return undefined;
    }
    if (!showFallback) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setShowFallback(false);
      setExiting(false);
      return undefined;
    }
    setExiting(true);
    const timer = window.setTimeout(() => {
      setShowFallback(false);
      setExiting(false);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [showSkeleton, showFallback]);

  const hasContent = !isLoading;
  return (
    <div className={`mz-skeleton-boundary ${className}`}>
      {hasContent && <div className={showFallback ? 'mz-boundary-content-waiting' : 'content-pop'}>{children}</div>}
      {showFallback && <SkeletonRegion className={`mz-boundary-skeleton${exiting ? ' is-exiting' : ''}`} label={label}>{fallback}</SkeletonRegion>}
    </div>
  );
}

export function FadeInContent({ children, className = '', board = false }) {
  return <div className={`${board ? 'content-pop-board' : 'content-pop'}${className ? ` ${className}` : ''}`}>{children}</div>;
}

export function StaggeredContent({ children, className = '' }) {
  return <div className={className}>{React.Children.map(children, (child, index) => <div className="content-pop-item" style={{ '--content-delay': `${Math.min(index * 40, 400)}ms` }}>{child}</div>)}</div>;
}
