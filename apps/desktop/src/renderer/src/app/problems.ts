import type { Problem } from '../session/store';

export interface ProblemCopy {
  title: string;
  body: string;
  action?: { label: string; kind: 'settings' | 'camera-privacy' | 'presage-keys' | 'retry' | 'home' };
}

/** Every problem in plain words, with the one thing that fixes it. */
export const PROBLEMS: Record<Problem, ProblemCopy> = {
  'no-key': { title: 'Measuring needs an access key', body: 'Add your SmartSpectra key in Settings, or put it in the .env file next to the app.', action: { label: 'Open Settings', kind: 'settings' } },
  'invalid-key': { title: 'The access key wasn’t accepted', body: 'Check the SmartSpectra key in Settings. It may have been mistyped or revoked.', action: { label: 'Open Settings', kind: 'settings' } },
  credit: { title: 'Measuring minutes used up', body: 'Your SmartSpectra plan has no minutes left this period. Top up in the Presage dashboard to continue.', action: { label: 'Open dashboard', kind: 'presage-keys' } },
  network: { title: 'Couldn’t check the access key', body: 'Measuring runs on this Mac, but the key is checked online first. Check your internet connection and try again.', action: { label: 'Try again', kind: 'retry' } },
  'camera-denied': { title: 'Camera access is off', body: 'Allow Counterfeed in System Settings › Privacy & Security › Camera, then try again.', action: { label: 'Open privacy settings', kind: 'camera-privacy' } },
  'camera-busy': { title: 'The camera is in use', body: 'Another app is using the camera. Close it (video calls, Photo Booth) and try again.', action: { label: 'Try again', kind: 'retry' } },
  'camera-missing': { title: 'No camera found', body: 'Counterfeed needs a front camera. Connect one and try again.', action: { label: 'Try again', kind: 'retry' } },
  unavailable: { title: 'Measuring didn’t start', body: 'The measuring engine didn’t respond. Restart Counterfeed; if it keeps happening, open Camera check.', action: { label: 'Back to home', kind: 'home' } },
  failed: { title: 'Measuring stopped', body: 'Something went wrong while measuring. Starting again usually fixes it.', action: { label: 'Back to home', kind: 'home' } },
  'low-frame-rate': { title: 'The camera is struggling', body: 'More light on your face helps the camera keep up.', action: { label: 'Try again', kind: 'retry' } },
  'video-error': { title: 'This video can’t be played', body: 'Counterfeed plays MP4 (H.264), MOV and WebM files. Try exporting the video in one of those.', action: { label: 'Back to home', kind: 'home' } },
};
