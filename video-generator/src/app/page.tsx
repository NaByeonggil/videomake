/**
 * Video Generator - Main Page
 */

'use client';

import { useState } from 'react';
import { ProjectList } from '@/components/projects/ProjectList';
import { ClipEditor } from '@/components/clips/ClipEditor';
import { VideoGallery } from '@/components/clips/VideoGallery';
import { Timeline } from '@/components/timeline/Timeline';
import { JobMonitor } from '@/components/common/JobMonitor';
import { SystemMonitorBar } from '@/components/common/SystemMonitorBar';

type TabType = 'editor' | 'gallery';

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>('editor');

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* System Monitor */}
      <SystemMonitorBar />

      {/* Header */}
      <header className="bg-white border-b px-6 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Video Generator</h1>
            <p className="text-sm text-gray-500">AI-powered video creation with AnimateDiff</p>
          </div>

          {/* Tab Navigation */}
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('editor')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'editor'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Editor
              </span>
            </button>
            <button
              onClick={() => setActiveTab('gallery')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'gallery'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Gallery
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar - Project list */}
        <aside className="w-64 bg-white border-r flex-shrink-0 overflow-hidden">
          <ProjectList />
        </aside>

        {/* Center content - switches based on tab */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {activeTab === 'editor' ? (
            <>
              <div className="flex-1 overflow-hidden">
                <ClipEditor />
              </div>
              {/* Bottom - Timeline */}
              <div className="h-96 border-t bg-white">
                <Timeline />
              </div>
            </>
          ) : (
            <VideoGallery />
          )}
        </main>
      </div>

      {/* Job monitor */}
      <JobMonitor />
    </div>
  );
}
