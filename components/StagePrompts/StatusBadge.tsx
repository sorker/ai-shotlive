import React from 'react';
import { STATUS_STYLES, STATUS_LABELS } from './constants';

type Status = 'completed' | 'generating' | 'failed' | 'idle';

interface Props {
  status: Status;
  className?: string;
}

const StatusBadge: React.FC<Props> = ({ status, className = '' }) => {
  const statusClass = STATUS_STYLES[status];
  const label = STATUS_LABELS[status];

  return (
    <span className={`text-xs px-2 py-0.5 rounded ${statusClass} ${className}`}>
      {label}
    </span>
  );
};

export default StatusBadge;
