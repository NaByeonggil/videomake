/**
 * Job Monitor component - shows active jobs with progress
 */

'use client';

import React, { useEffect } from 'react';
import { useProjectStore } from '@/stores/projectStore';
import { useJobProgress, useCancelJob } from '@/hooks/useJobs';
import { ProgressBar } from './ProgressBar';

export function JobMonitor() {
  const activeJobs = useProjectStore((state) => state.activeJobs);

  if (activeJobs.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 w-80 space-y-2 z-40">
      {activeJobs.map((job) => (
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  );
}

interface JobCardProps {
  job: {
    id: string;
    jobType: string;
    jobStatus: string;
    progressPercent: number;
    errorMessage: string | null;
  };
}

function JobCard({ job }: JobCardProps) {
  const updateJob = useProjectStore((state) => state.updateJob);
  const removeJob = useProjectStore((state) => state.removeJob);
  const cancelJob = useCancelJob();

  // Monitor job progress
  useJobProgress(
    job.jobStatus === 'pending' || job.jobStatus === 'processing' ? job.id : null,
    (data) => {
      updateJob(job.id, {
        progressPercent: data.percent || job.progressPercent,
        jobStatus: 'processing',
      });
    },
    () => {
      updateJob(job.id, {
        progressPercent: 100,
        jobStatus: 'completed',
      });
    },
    (error) => {
      updateJob(job.id, {
        jobStatus: 'failed',
        errorMessage: error,
      });
    }
  );

  // Auto-remove completed jobs
  useEffect(() => {
    if (job.jobStatus === 'completed') {
      const timer = setTimeout(() => removeJob(job.id), 3000);
      return () => clearTimeout(timer);
    }
  }, [job.jobStatus, job.id, removeJob]);

  const jobTypeLabels: Record<string, string> = {
    generate: 'Generating clip',
    merge: 'Merging videos',
    upscale: 'Upscaling',
    interpolate: 'Interpolating',
    export: 'Exporting',
  };

  const statusColors = {
    pending: 'border-gray-200',
    processing: 'border-blue-400',
    completed: 'border-green-400',
    failed: 'border-red-400',
  };

  const handleCancel = async () => {
    if (job.jobStatus === 'processing') {
      await cancelJob.mutateAsync(job.id);
    } else {
      removeJob(job.id);
    }
  };

  return (
    <div
      className={`bg-white rounded-lg shadow-lg border-l-4 p-4 ${
        statusColors[job.jobStatus as keyof typeof statusColors]
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-medium text-gray-900">
            {jobTypeLabels[job.jobType] || job.jobType}
          </p>
          {job.errorMessage && (
            <p className="text-sm text-red-600 mt-1">{job.errorMessage}</p>
          )}
        </div>
        <button
          onClick={handleCancel}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {job.jobStatus !== 'failed' && (
        <ProgressBar
          progress={job.progressPercent}
          variant={job.jobStatus === 'completed' ? 'success' : 'default'}
          showPercent={true}
          size="sm"
        />
      )}
    </div>
  );
}
