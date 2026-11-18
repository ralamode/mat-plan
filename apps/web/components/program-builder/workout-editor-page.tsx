'use client';

import { howToLoader } from './how-to-loader';
import { WorkoutEditorScreen, type WorkoutEditorScreenProps } from './workout-editor-screen';

/**
 * The workout editor as a real page mounts it (FAM-1 7b): the screen with the real "How to" loader.
 * A Server Component cannot pass a plain function to a Client Component, so the page renders this
 * wrapper and the loader is supplied on the client. The design preview mounts the screen itself,
 * with its own fixture loader.
 */
export function WorkoutEditorPage(props: Omit<WorkoutEditorScreenProps, 'howTo'>) {
  return <WorkoutEditorScreen {...props} howTo={howToLoader} />;
}
