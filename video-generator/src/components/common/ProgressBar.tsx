/**
 * Progress Bar component
 */

import React from 'react';

interface ProgressBarProps {
  progress: number;
  message?: string;
  variant?: 'default' | 'success' | 'error';
  showPercent?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function ProgressBar({
  progress,
  message,
  variant = 'default',
  showPercent = true,
  size = 'md',
}: ProgressBarProps) {
  const clampedProgress = Math.min(100, Math.max(0, progress));

  const variants = {
    default: 'bg-blue-600',
    success: 'bg-green-600',
    error: 'bg-red-600',
  };

  const sizes = {
    sm: 'h-1',
    md: 'h-2',
    lg: 'h-3',
  };

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1">
        {message && (
          <span className="text-sm text-gray-600 truncate">{message}</span>
        )}
        {showPercent && (
          <span className="text-sm font-medium text-gray-700">
            {Math.round(clampedProgress)}%
          </span>
        )}
      </div>
      <div className={`w-full bg-gray-200 rounded-full overflow-hidden ${sizes[size]}`}>
        <div
          className={`${sizes[size]} ${variants[variant]} rounded-full transition-all duration-300 ease-out`}
          style={{ width: `${clampedProgress}%` }}
        />
      </div>
    </div>
  );
}
