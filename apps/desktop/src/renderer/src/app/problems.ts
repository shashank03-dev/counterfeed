import type { Problem } from '../session/store';

export interface ProblemCopy {
  title: string;
  body: string;
  action?: { label: string; kind: 'settings' | 'camera-privacy' | 'mic-privacy' | 'presage-keys' | 'retry' | 'home' };
  /** Ends the session vs. a notice the call can continue through. */
  blocking: boolean;
}

/** Every problem in plain words, with the one thing that fixes it. */
export const PROBLEMS: Record<Problem, ProblemCopy> = {
  'no-key': { title: 'Measurement needs an access key', body: 'Add your SmartSpectra key in Settings, or put it in the .env file next to the app.', action: { label: 'Open Settings', kind: 'settings' }, blocking: true },
  'invalid-key': { title: 'The access key was not accepted', body: 'Check the SmartSpectra key in Settings. It may have been mistyped or revoked.', action: { label: 'Open Settings', kind: 'settings' }, blocking: true },
  credit: { title: 'Measurement minutes used up', body: 'Your SmartSpectra plan has no minutes left this period. Top up in the Presage dashboard to continue.', action: { label: 'Open dashboard', kind: 'presage-keys' }, blocking: true },
  network: { title: 'Couldn’t verify the access key', body: 'Measurement runs on this laptop, but the key is checked online first. Check your internet connection and try again.', action: { label: 'Try again', kind: 'retry' }, blocking: true },
  'camera-denied': { title: 'Camera access is off', body: 'Allow Together in System Settings › Privacy & Security › Camera, then try again.', action: { label: 'Open privacy settings', kind: 'camera-privacy' }, blocking: true },
  'camera-busy': { title: 'The camera is in use', body: 'Another app is using the camera. Close it (video calls, Photo Booth) and try again.', action: { label: 'Try again', kind: 'retry' }, blocking: true },
  'camera-missing': { title: 'No camera found', body: 'Together needs a front camera to measure breathing. Connect one and try again.', action: { label: 'Try again', kind: 'retry' }, blocking: true },
  unavailable: { title: 'Measurement didn’t start', body: 'The measurement engine didn’t respond. Restart Together; if it keeps happening, check Diagnostics.', action: { label: 'Back to home', kind: 'home' }, blocking: true },
  failed: { title: 'Measurement stopped', body: 'Something went wrong while measuring. Starting again usually fixes it.', action: { label: 'Back to home', kind: 'home' }, blocking: true },
  'low-frame-rate': { title: 'The camera is struggling', body: 'More light on your face helps the camera keep a steady frame rate.', blocking: false },
  'mic-denied': { title: 'Your microphone is off', body: 'Your partner can see you but not hear you. Allow the microphone in System Settings to talk.', action: { label: 'Open privacy settings', kind: 'mic-privacy' }, blocking: false },
  'signal-unreachable': { title: 'Can’t reach the connection server', body: 'Check your internet connection, or the server address in Settings › Connection.', action: { label: 'Open Settings', kind: 'settings' }, blocking: true },
  'room-not-found': { title: 'No room with that code', body: 'Check the code with the person who sent it. Rooms close after 10 quiet minutes.', action: { label: 'Back to home', kind: 'home' }, blocking: true },
  'room-full': { title: 'That room already has two people', body: 'Each room is for two. Ask for a new code.', action: { label: 'Back to home', kind: 'home' }, blocking: true },
  'rate-limited': { title: 'Too many tries', body: 'Wait a minute, then try the code again.', action: { label: 'Back to home', kind: 'home' }, blocking: true },
  expired: { title: 'This room has closed', body: 'Rooms close after 10 quiet minutes. Start a new one.', action: { label: 'Back to home', kind: 'home' }, blocking: true },
  'ice-failed': { title: 'Couldn’t connect to each other', body: 'Your network may block direct calls. Adding a TURN relay in Settings › Connection usually fixes this.', action: { label: 'Open Settings', kind: 'settings' }, blocking: true },
  'recording-missing': { title: 'No recording to replay', body: 'Turn on “Record my signals” in Settings and finish a session first. Recordings hold numbers only, no video.', action: { label: 'Open Settings', kind: 'settings' }, blocking: true },
};
