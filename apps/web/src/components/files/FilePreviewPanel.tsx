import { DownloadIcon, CopyIcon, CheckIcon, Code2Icon, EyeIcon, Table2Icon } from "lucide-react";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { useGT, msg, T } from "gt-react";
import { m } from "~/i18n/messages";
import { namedClipboardTarget, useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { Spinner } from "~/components/ui/spinner";
import {
  type AssetResource,
  AuthPreviewOperateScope,
  type EditorId,
  type EnvironmentId,
  type ProjectId,
  type ResolvedKeybindingsConfig,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { filePreviewDelimiter } from "@t3tools/shared/delimitedPreview";
import { AuthFilesystemWriteScope } from "@t3tools/contracts";
import {
  isWorkspaceAudioPreviewPath,
  isWorkspaceImagePreviewPath,
  isWorkspaceFontPreviewPath,
  isWorkspaceVideoPreviewPath,
  officePreviewKind,
  binaryPreviewKind,
} from "@t3tools/shared/filePreview";
import {
  extractMermaidCodeBlocks,
  findDiagramSectionLines,
  mermaidSourcesMatch,
  type MermaidCodeBlock,
} from "@t3tools/shared/mermaidBlocks";
import { useAtomMount, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import {
  VirtualizedFile,
  type File as FileInstance,
  type FileContents,
  type PostRenderPhase,
  type SelectedLineRange,
} from "@pierre/diffs";
import {
  Editor,
  type EditorChangeEvent,
  type EditorFactory,
  type EditorOptions,
} from "@pierre/diffs/edit";
import { EditProvider, File, Virtualizer } from "@pierre/diffs/react";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import { useEditableAfterHighlight } from "./useEditableAfterHighlight";
import { useFilesystemReadAccess } from "~/state/filesystem";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { mediaFileReference } from "@t3tools/client-runtime/media-reference";
import { FolderTree, Globe2, WrapTextIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

import { isBrowserPreviewFile, openFileInPreview } from "~/browser/openFileInPreview";
import { useAssetUrlRefresh, useAssetUrlState } from "~/assets/assetUrls";
import { OpenInPicker } from "~/components/chat/OpenInPicker";
import { fileManagerActionForPath } from "~/components/chat/OpenInPicker.logic";
import { MediaVideoPlayer } from "~/components/media/MediaVideoPlayer";
import { MediaActions, type MediaActionSource } from "~/components/media/MediaActions";
import { useRemoteOpenState } from "~/remoteOpen";
import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { useStableCallback } from "~/hooks/useStableCallback";
import { getLocalStorageItem, setLocalStorageItem, useLocalStorage } from "~/hooks/useLocalStorage";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { cn, isMacPlatform } from "~/lib/utils";
import { requestWorkspaceFocus } from "~/lib/workspaceFocus";
import type { ChatFileAttachment } from "~/types";
import { isHostPath } from "@t3tools/shared/path";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { ScrollArea } from "~/components/ui/scroll-area";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import {
  buildDiagramReviewComment,
  buildFileReviewComment,
  type ReviewCommentContext,
} from "~/reviewCommentContext";
import { diagramSectionLabel, type DiagramSection } from "../chat/MermaidDiagram";
import { assetEnvironment } from "~/state/assets";
import { usePreviewAvailable } from "~/browser/previewRuntime";
import { useEnvironmentHttpBaseUrl, usePrimaryEnvironmentId } from "~/state/environments";
import { hostEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { previewEnvironment } from "~/state/preview";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";

import { AttachmentFilePreview } from "./AttachmentFilePreview";
import { AudioPreview } from "./AudioPreview";
import { BrowserDocumentFrame, isPdfPreviewFile } from "./BrowserDocumentFrame";
import { DelimitedTablePreview } from "./DelimitedTablePreview";
import { PreviewImage } from "./PreviewImage";
import FileBrowserPanel from "./FileBrowserPanel";
import { FileExplorerPane } from "./FileExplorerPane";
import { FileBreadcrumbs } from "./FileBreadcrumbs";
import { breadcrumbPathOf, retainedBreadcrumbTrail, trailChildOf } from "./filePath";
import { FileMarkdownPreview } from "./FileMarkdownPreview";
import { MarkdownFindBar } from "./MarkdownFindBar";
import { MarkdownViewCommentToolbar } from "./MarkdownViewCommentToolbar";
import { useMarkdownFind } from "./useMarkdownFind";
import {
  type FileCommentAnnotationEntry,
  type FileCommentAnnotationGroup,
  formatFileCommentRange,
  groupFileCommentEntries,
  nextFileCommentId,
  normalizeFileCommentRange,
  remapFileCommentAnnotations,
  promptFileCommentEntries,
} from "./fileCommentAnnotations";
import { installFileEditorDismissal } from "./fileEditorDismissal";
import {
  FILE_LINK_REVEAL_ATTRIBUTE,
  FILE_LINK_REVEAL_UNSAFE_CSS,
  FILE_SURFACE_SUBHEADER_CLASS,
  FileSurfaceAction,
  FileSurfaceFailure,
  FileSurfaceLoading,
} from "./fileSurfaceChrome";
import SourceFilePreview from "./ReadOnlySourcePreview";
import LargeFilePreview from "./LargeFilePreview";
import { FULL_TEXT_MAX_BYTES } from "./largeTextProtocol";
import { resolveCenteredFileLineScrollTop } from "./fileLineReveal";
import { DiffCommentAnnotation } from "../diffs/DiffCommentAnnotation";
import { projectFileCacheKey } from "./fileContentRevision";
import {
  filePreviewReadErrorMessage,
  isMarkdownPreviewFile,
  resolveFilePreviewPath,
  shouldShowFileExplorer,
  workspaceAssetResource,
} from "./filePreviewMode";
import { setMarkdownTaskChecked } from "@t3tools/shared/markdownTaskEdits";
import { changeFileSaveSession, useFileSaveSession } from "./fileSaveSessions";
import { revisionedQuery } from "~/state/revisionedQuery";
import {
  getOptimisticProjectFileQueryData,
  getProjectFileContents,
  getProjectFileQueryAtom,
  setProjectFileQueryData,
  useProjectFileQuery,
} from "./projectFilesQueryState";

const NO_FILE_REVISION_ATOM = Atom.make(null);

interface FilePreviewPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  projectId?: ProjectId | undefined;
  relativePath: string | null;
  attachment?: ChatFileAttachment;
  threadRef: ScopedThreadRef;
  composerDraftTarget: ScopedThreadRef | DraftId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInShortcutEnabled: boolean;
  revealLine: number | null;
  revealRequestId: number;
  onOpenFile: (relativePath: string) => void;
  onNavigateFolder: (relativePath: string, folderTrail: string, keepSource: boolean) => void;
  /** Retained descendant breadcrumb path after navigating up; see navigateFolder. */
  folderTrail: string | undefined;
  onPendingChange: (relativePath: string, pending: boolean) => void;
  selectedFilePending: boolean;
  workspaceMutationId: string | null;
}

const MermaidFilePreview = lazy(() =>
  import("./MermaidFilePreview").then((module) => ({ default: module.MermaidFilePreview })),
);

const MermaidBlocksPreview = lazy(() =>
  import("./MermaidBlocksPreview").then((module) => ({ default: module.MermaidBlocksPreview })),
);

const LargeTextViewer = lazy(() => import("./LargeTextViewer"));

const FILE_EXPLORER_STORAGE_KEY = "t3code.fileExplorerOpen";
const RENDER_MARKDOWN_STORAGE_KEY = "t3code.renderMarkdown";
const RENDER_BROWSER_FILE_STORAGE_KEY = "t3code.renderBrowserFile";
const RENDER_TABLE_STORAGE_KEY = "t3code.renderTable";
const RENDER_DIAGRAMS_STORAGE_KEY = "t3code.renderDiagrams";
type FilePostRender = <LAnnotation>(
  fileContainer: HTMLElement,
  instance: FileInstance<LAnnotation, undefined>,
  phase: PostRenderPhase,
) => void;

function WorkspaceImagePreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly draft: boolean;
  readonly absolutePath: string;
  readonly workspaceRoot: string;
  readonly alt: string;
  readonly workspaceMutationId: string | null;
}) {
  const resource = workspaceAssetResource({
    kind:
      mediaFileReference(props.absolutePath, props.workspaceRoot).relativePath !== undefined
        ? "workspace-file"
        : "media-file",
    threadRef: props.threadRef,
    draft: props.draft,
    workspaceRoot: props.workspaceRoot,
    absolutePath: props.absolutePath,
  });
  const assetUrl = useAssetUrlState(props.environmentId, resource);
  const revisionSuffix =
    props.workspaceMutationId === null
      ? ""
      : `${assetUrl._tag === "Success" && assetUrl.url.includes("?") ? "&" : "?"}workspace-revision=${encodeURIComponent(props.workspaceMutationId)}`;
  const imageUrl = assetUrl._tag === "Success" ? `${assetUrl.url}${revisionSuffix}` : null;
  const actionsSource: MediaActionSource = {
    kind: "image",
    name: props.alt,
    src: imageUrl,
    reference: mediaFileReference(props.absolutePath, props.workspaceRoot),
    asset: { environmentId: props.environmentId, resource },
  };

  if (assetUrl._tag === "Failure") {
    return (
      <MediaActions source={actionsSource}>
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-destructive">
          <T>Unable to load workspace image.</T>
        </div>
      </MediaActions>
    );
  }

  return assetUrl._tag === "Success" && imageUrl !== null ? (
    <MediaActions source={actionsSource}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PreviewImage key={imageUrl} src={imageUrl} name={props.alt} />
      </div>
    </MediaActions>
  ) : (
    <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
      <Spinner size="lg" />
    </div>
  );
}

export function WorkspaceBrowserPreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly draft: boolean;
  readonly absolutePath: string;
  readonly workspaceRoot: string;
  readonly title: string;
  readonly workspaceMutationId: string | null;
}) {
  const pdf = isPdfPreviewFile(props.absolutePath);
  const resource = workspaceAssetResource({
    kind: pdf ? "media-file" : "workspace-file",
    threadRef: props.threadRef,
    draft: props.draft,
    workspaceRoot: props.workspaceRoot,
    absolutePath: props.absolutePath,
  });
  // Each workspace mutation re-mints the URL: a file outside the workspace is signed by its
  // inode, which an atomic replace changes.
  const assetUrl = useAssetUrlState(props.environmentId, resource, props.workspaceMutationId);
  // The HTML frame keeps its first URL per key, so the key moves only once the re-minted URL arrives.
  const [settledMutationId, setSettledMutationId] = useState(props.workspaceMutationId);
  if (
    assetUrl._tag === "Success" &&
    !assetUrl.waiting &&
    settledMutationId !== props.workspaceMutationId
  ) {
    setSettledMutationId(props.workspaceMutationId);
  }
  const fileRevision = pdf && assetUrl._tag === "Success" ? assetUrl.fileRevision : undefined;
  const revision = fileRevision ?? (pdf ? props.workspaceMutationId : settledMutationId);
  const revisionSuffix =
    revision === null
      ? ""
      : `${assetUrl._tag === "Success" && assetUrl.url.includes("?") ? "&" : "?"}${fileRevision !== undefined ? "file" : "workspace"}-revision=${encodeURIComponent(revision)}`;

  if (assetUrl._tag === "Failure") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-destructive">
        <T>Unable to load file preview.</T>
      </div>
    );
  }
  if (
    assetUrl._tag !== "Success" ||
    (pdf && assetUrl.fileRevision === undefined && assetUrl.waiting)
  ) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
        <Spinner size="lg" />
      </div>
    );
  }
  return (
    <BrowserDocumentFrame
      src={`${assetUrl.url}${revisionSuffix}`}
      documentKey={`${props.environmentId}:${resource._tag}:${props.threadRef.threadId}:${props.absolutePath}:${revision}`}
      documentId={`${props.environmentId}:${resource._tag}:${props.threadRef.threadId}:${props.absolutePath}`}
      title={props.title}
      pdf={pdf}
      threadRef={props.threadRef}
      pdfActions={
        <WorkspacePdfSaveAction
          environmentId={props.environmentId}
          resource={resource}
          name={props.title}
        />
      }
    />
  );
}

function WorkspacePdfSaveAction(props: {
  readonly environmentId: EnvironmentId;
  readonly resource: AssetResource;
  readonly name: string;
}) {
  const gt = useGT();
  const [saving, setSaving] = useState(false);
  const refreshAssetUrl = useAssetUrlRefresh(props.environmentId, props.resource);
  return (
    <FileSurfaceAction
      label={saving ? gt("Preparing file…") : gt("Save file")}
      disabled={saving}
      onPress={() => {
        setSaving(true);
        void (async () => {
          const url = await refreshAssetUrl();
          if (!url) throw new Error(gt("Reconnect to the environment and try again."));
          const response = await fetch(url);
          if (!response.ok) throw new Error(gt("The file could not be loaded. Try again."));
          // Blob downloads keep desktop's custom app scheme from navigating to an external browser.
          const downloadUrl = URL.createObjectURL(await response.blob());
          setTimeout(() => URL.revokeObjectURL(downloadUrl), 30_000);
          const anchor = document.createElement("a");
          anchor.href = downloadUrl;
          anchor.download = props.name.split(/[\\/]/).at(-1) || props.name;
          anchor.click();
        })()
          .catch((cause: unknown) =>
            toastManager.add({
              type: "error",
              title: gt("Could not save file"),
              description: thrownErrorMessage(cause, m) ?? gt("Please try again."),
            }),
          )
          .finally(() => setSaving(false));
      }}
    >
      <DownloadIcon className="size-3.5" />
    </FileSurfaceAction>
  );
}

function WorkspaceVideoPreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly draft: boolean;
  readonly absolutePath: string;
  readonly workspaceRoot: string;
  readonly name: string;
  readonly workspaceMutationId: string | null;
}) {
  const resource = workspaceAssetResource({
    kind: "media-file",
    threadRef: props.threadRef,
    draft: props.draft,
    workspaceRoot: props.workspaceRoot,
    absolutePath: props.absolutePath,
  });
  // Each workspace mutation re-mints the URL, so an edited file loads its new bytes.
  const assetUrl = useAssetUrlState(
    props.environmentId,
    resource,
    props.workspaceMutationId ?? undefined,
  );
  const refreshAssetUrl = useAssetUrlRefresh(props.environmentId, resource);
  // Servers that report the file's revision let an unchanged file stay loaded; older ones
  // only offer the workspace mutation, which changes after every command. The revision also
  // goes in the URL, since two mints in the same millisecond sign identical URLs.
  const fileRevision = assetUrl._tag === "Success" ? assetUrl.fileRevision : undefined;
  const revision = fileRevision ?? props.workspaceMutationId;
  const revisionSuffix =
    revision === null
      ? ""
      : `${assetUrl._tag === "Success" && assetUrl.url.includes("?") ? "&" : "?"}${fileRevision !== undefined ? "file" : "workspace"}-revision=${encodeURIComponent(revision)}`;
  const latestUrl = assetUrl._tag === "Success" ? `${assetUrl.url}${revisionSuffix}` : null;

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
      <MediaVideoPlayer
        src={latestUrl}
        sourceFailed={assetUrl._tag === "Failure"}
        label={props.name}
        revision={revision}
        preload="metadata"
        className="flex h-full min-h-0 w-full max-w-5xl items-center justify-center"
        videoClassName="aspect-auto max-h-full w-auto max-w-full"
        onRetry={refreshAssetUrl}
        actionsSource={{
          kind: "video",
          name: props.name,
          src: latestUrl,
          reference: mediaFileReference(props.absolutePath, props.workspaceRoot),
          asset: { environmentId: props.environmentId, resource },
        }}
      />
    </div>
  );
}

function WorkspaceAudioPreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly draft: boolean;
  readonly absolutePath: string;
  readonly workspaceRoot: string;
  readonly name: string;
  readonly workspaceMutationId: string | null;
}) {
  const resource = workspaceAssetResource({
    kind: "media-file",
    threadRef: props.threadRef,
    draft: props.draft,
    workspaceRoot: props.workspaceRoot,
    absolutePath: props.absolutePath,
  });
  const assetUrl = useAssetUrlState(
    props.environmentId,
    resource,
    props.workspaceMutationId ?? undefined,
  );
  const refreshAssetUrl = useAssetUrlRefresh(props.environmentId, resource);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const fileRevision = assetUrl._tag === "Success" ? assetUrl.fileRevision : undefined;
  const revision = fileRevision ?? props.workspaceMutationId;
  const revisionSuffix =
    revision === null
      ? ""
      : `${assetUrl._tag === "Success" && assetUrl.url.includes("?") ? "&" : "?"}${fileRevision !== undefined ? "file" : "workspace"}-revision=${encodeURIComponent(revision)}`;
  const url = assetUrl._tag === "Success" ? `${assetUrl.url}${revisionSuffix}` : null;
  if (assetUrl._tag === "Failure" || (url !== null && failedUrl === url)) {
    return (
      <FileSurfaceFailure
        message={msg("Unable to load audio.")}
        onRetry={() => {
          setFailedUrl(null);
          void refreshAssetUrl().catch(() => undefined);
        }}
      />
    );
  }
  if (url === null) return <FileSurfaceLoading />;
  return (
    <AudioPreview
      src={url}
      name={props.name}
      revision={revision}
      onError={() => setFailedUrl(url)}
    />
  );
}

function WorkspaceDocumentPreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly draft: boolean;
  readonly document: boolean;
  readonly absolutePath: string;
  readonly workspaceRoot: string;
  readonly name: string;
  readonly workspaceMutationId: string | null;
  readonly refreshRevision: number;
}) {
  const resource =
    props.draft && props.document
      ? {
          _tag: "draft-workspace-file" as const,
          cwd: props.workspaceRoot,
          path: props.absolutePath,
        }
      : {
          _tag: "media-file" as const,
          threadId: props.threadRef.threadId,
          path: props.absolutePath,
          ...(props.document ? {} : { disposition: "attachment" as const }),
        };
  // Drafts keep reloading on every workspace mutation, as before.
  const revisioned = resource._tag === "media-file";
  const assetUrl = useAssetUrlState(
    props.environmentId,
    revisioned ? resource : null,
    props.workspaceMutationId ?? undefined,
  );
  const resolved =
    assetUrl._tag === "Success" ? (assetUrl.fileRevision ?? props.workspaceMutationId) : undefined;
  // A reconnect reports Loading and keeps the last revision, so the open file stays loaded;
  // a failure (say the file was deleted) remounts so the preview shows its error.
  const [shown, setShown] = useState(resolved);
  if (resolved !== undefined && resolved !== shown) setShown(resolved);
  const revision = !revisioned
    ? props.workspaceMutationId
    : assetUrl._tag === "Failure"
      ? `failure:${props.workspaceMutationId}`
      : (resolved ?? shown);
  // Waiting on the first revision keeps the preview from mounting twice when it opens.
  if (revisioned && revision === undefined && assetUrl._tag === "Loading") {
    return <FileSurfaceLoading />;
  }
  return (
    <AttachmentFilePreview
      key={`${revision}:${props.refreshRevision}`}
      name={props.name}
      mimeType="application/octet-stream"
      sizeBytes={0}
      asset={{ environmentId: props.environmentId, resource }}
      origin="File"
    />
  );
}

function clampFileLine(contents: string, requestedLine: number): number {
  let lineCount = 1;
  for (let index = 0; index < contents.length; index += 1) {
    const character = contents.charCodeAt(index);
    if (character === 10) {
      lineCount += 1;
    } else if (character === 13) {
      lineCount += 1;
      if (contents.charCodeAt(index + 1) === 10) index += 1;
    }
  }
  return Math.min(Math.max(1, requestedLine), lineCount);
}

function updateFileLinkReveal(fileContainer: HTMLElement, line: number | null): void {
  const root = fileContainer.shadowRoot ?? fileContainer;
  for (const element of root.querySelectorAll<HTMLElement>(`[${FILE_LINK_REVEAL_ATTRIBUTE}]`)) {
    element.removeAttribute(FILE_LINK_REVEAL_ATTRIBUTE);
  }
  if (line === null) return;

  root
    .querySelector<HTMLElement>(`[data-line="${line}"]`)
    ?.setAttribute(FILE_LINK_REVEAL_ATTRIBUTE, "");
  root
    .querySelector<HTMLElement>(`[data-column-number="${line}"]`)
    ?.setAttribute(FILE_LINK_REVEAL_ATTRIBUTE, "");
}

const REVEAL_MAX_ATTEMPTS = 30;
/** Hold the reveal target against late focus/restoration scroll resets. */
const REVEAL_GUARD_FRAMES = 20;
const REVEAL_GUARD_TOLERANCE_PX = 2;

interface FileRevealState {
  frameId: number | null;
  cancelGuard: (() => void) | null;
  handledRequestId: number | null;
  latestRequestId: number | null;
  /** The path's code view offset when it last unmounted, restored when it is shown again. */
  scrollTop: number;
  scrollContainer: HTMLElement | null;
  restoreFrameId: number | null;
  /** Where CodeView settled on the revealed line, while the view is still there. */
  revealedScrollTop: number | null;
}

/** Session-lived, so switching tabs, threads or popout windows reopens a file where it was left. */
const fileScrollMemory = new Map<string, { top: number; revealRequestId: number }>();

interface FileScrollTracker {
  key: string;
  container: HTMLElement;
  /** False while a remembered position is still being restored, so clamped tops aren't recorded. */
  recording: boolean;
  /** The reveal request the restored position already honored. */
  restoredRequestId: number | null;
  /** The surface's current reveal request, stamped on each recorded position. */
  revealRequestId: number;
  dispose: () => void;
}

/** Holds a scroll target briefly against late programmatic resets; real user input releases it. */
function holdScrollTarget(
  scrollContainer: HTMLElement,
  resolveTarget: () => number | null,
  afterHold?: () => void,
): () => void {
  let framesLeft = REVEAL_GUARD_FRAMES;
  let frameId: number | null = null;
  const release = () => {
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
    scrollContainer.removeEventListener("wheel", release);
    scrollContainer.removeEventListener("touchstart", release);
    scrollContainer.removeEventListener("pointerdown", release, true);
    window.removeEventListener("keydown", release, true);
  };
  scrollContainer.addEventListener("wheel", release, { passive: true });
  scrollContainer.addEventListener("touchstart", release, { passive: true });
  // Pierre stops gutter pointer events from bubbling. Listen in capture
  // so starting a comment releases the hold before the row expands.
  scrollContainer.addEventListener("pointerdown", release, { passive: true, capture: true });
  window.addEventListener("keydown", release, true);
  const hold = () => {
    frameId = null;
    framesLeft -= 1;
    if (framesLeft <= 0 || !scrollContainer.isConnected) {
      release();
      return;
    }
    const targetTop = resolveTarget();
    if (
      targetTop !== null &&
      Math.abs(scrollContainer.scrollTop - targetTop) > REVEAL_GUARD_TOLERANCE_PX
    ) {
      scrollContainer.scrollTop = targetTop;
    }
    afterHold?.();
    frameId = requestAnimationFrame(hold);
  };
  frameId = requestAnimationFrame(hold);
  return release;
}

function useFileLineReveal(
  scrollKey: string | null,
  relativePath: string | null,
  revealLine: number | null,
  revealRequestId: number,
): (scroller: "virtualizer" | "codeView") => FilePostRender {
  const [revealStatesByPath] = useState(() => new Map<string, FileRevealState>());
  const scrollTrackerRef = useRef<FileScrollTracker | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Stops recording before the next file clamps scrollTop.
  useLayoutEffect(
    () => () => {
      scrollTrackerRef.current?.dispose();
      scrollTrackerRef.current = null;
    },
    [scrollKey], // oxlint-disable-line react/exhaustive-effect-dependencies -- scrollKey re-disposes the tracker on each open request.
  );

  // Returns whether a remembered position covers this reveal request, so the reveal is skipped.
  const trackFileScroll = (
    key: string,
    scrollContainer: HTMLElement,
    revealRequestId: number,
  ): boolean => {
    const current = scrollTrackerRef.current;
    if (current?.key === key && current.container === scrollContainer) {
      current.revealRequestId = revealRequestId;
      return current.restoredRequestId === revealRequestId;
    }
    current?.dispose();

    const saved = fileScrollMemory.get(key);
    const restoring = saved !== undefined && saved.revealRequestId === revealRequestId;
    let restoreFrameId: number | null = null;
    let releaseHold: (() => void) | null = null;
    const tracker: FileScrollTracker = {
      key,
      container: scrollContainer,
      recording: !restoring,
      restoredRequestId: restoring ? saved.revealRequestId : null,
      revealRequestId,
      dispose: () => {
        if (restoreFrameId !== null) cancelAnimationFrame(restoreFrameId);
        releaseHold?.();
        scrollContainer.removeEventListener("scroll", onScroll);
      },
    };
    const onScroll = () => {
      if (!tracker.recording) return;
      fileScrollMemory.set(key, {
        top: scrollContainer.scrollTop,
        revealRequestId: tracker.revealRequestId,
      });
    };
    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    scrollTrackerRef.current = tracker;
    if (!restoring) return false;

    // Virtualized content can be shorter than the saved top for a few frames after mount.
    const restore = (attempt: number) => {
      restoreFrameId = requestAnimationFrame(() => {
        restoreFrameId = null;
        if (!scrollContainer.isConnected) return;
        scrollContainer.scrollTop = saved.top;
        const reached =
          Math.abs(scrollContainer.scrollTop - saved.top) <= REVEAL_GUARD_TOLERANCE_PX;
        if (!reached && attempt < REVEAL_MAX_ATTEMPTS) {
          restore(attempt + 1);
          return;
        }
        tracker.recording = true;
        releaseHold = holdScrollTarget(scrollContainer, () => saved.top);
      });
    };
    restore(0);
    return true;
  };

  return (scroller) => (fileContainer, instance, phase) => {
    if (relativePath === null) return;

    const existingState = revealStatesByPath.get(relativePath);
    const state: FileRevealState = existingState ?? {
      frameId: null,
      cancelGuard: null,
      handledRequestId: null,
      latestRequestId: null,
      scrollTop: 0,
      scrollContainer: null,
      restoreFrameId: null,
      revealedScrollTop: null,
    };
    if (!existingState) revealStatesByPath.set(relativePath, state);

    const cancelPendingReveal = () => {
      if (state.frameId !== null) {
        cancelAnimationFrame(state.frameId);
        state.frameId = null;
      }
      state.cancelGuard?.();
      if (state.restoreFrameId !== null) {
        cancelAnimationFrame(state.restoreFrameId);
        state.restoreFrameId = null;
      }
    };

    const scrollContainer = fileContainer.closest<HTMLElement>(".file-preview-virtualizer");

    if (phase === "unmount") {
      cancelPendingReveal();

      scrollTrackerRef.current?.dispose();
      scrollTrackerRef.current = null;

      const restorePending = state.restoreFrameId !== null;
      if (scrollContainer && !restorePending) state.scrollTop = scrollContainer.scrollTop;
      // A rebuilt CodeView estimates its line heights again, so a saved offset no longer points at
      // the line. Starting the worker pool rebuilds the viewer right after its first render.
      if (state.revealedScrollTop !== null && state.revealedScrollTop === state.scrollTop) {
        state.handledRequestId = null;
      }
      state.revealedScrollTop = null;
      state.scrollContainer = null;

      return;
    }

    const contents = instance.file?.contents;
    const targetLine =
      revealLine === null || contents === undefined ? null : clampFileLine(contents, revealLine);
    updateFileLinkReveal(fileContainer, targetLine);

    if (!(instance instanceof VirtualizedFile)) return;

    if (state.latestRequestId !== revealRequestId) {
      cancelPendingReveal();
      state.latestRequestId = revealRequestId;
      state.handledRequestId = null;
    }

    const restoredScroll =
      scrollKey !== null &&
      scrollContainer !== null &&
      trackFileScroll(scrollKey, scrollContainer, revealRequestId);
    if (restoredScroll) state.handledRequestId = revealRequestId;

    if (revealLine === null) {
      fileContainer.style.minHeight = "";
      return;
    }

    if (!scrollContainer) return;
    // CodeView's file element is the mounted window of rows, which the viewer sizes and places.
    if (scroller === "virtualizer") {
      fileContainer.style.minHeight = `${Math.ceil(
        Math.max(instance.height, scrollContainer.clientHeight),
      )}px`;
    }

    if (state.handledRequestId === revealRequestId || state.frameId !== null) {
      return;
    }

    const resolveScrollTarget = (line: number): number | null => {
      const linePosition = instance.getLinePosition(line);
      if (!linePosition) return null;

      const scrollContainerRect = scrollContainer.getBoundingClientRect();
      const fileTop =
        scrollContainer.scrollTop +
        fileContainer.getBoundingClientRect().top -
        scrollContainerRect.top;
      const root = fileContainer.shadowRoot ?? fileContainer;
      const renderedLineElement = root.querySelector<HTMLElement>(`[data-line="${line}"]`);
      const renderedLineRect = renderedLineElement?.getBoundingClientRect();

      return resolveCenteredFileLineScrollTop({
        scrollTop: scrollContainer.scrollTop,
        scrollHeight: scrollContainer.scrollHeight,
        viewportTop: scrollContainerRect.top,
        viewportHeight: scrollContainer.clientHeight,
        fileTop,
        estimatedLine: linePosition,
        ...(renderedLineRect && renderedLineRect.height > 0
          ? {
              renderedLine: {
                top: renderedLineRect.top,
                height: renderedLineRect.height,
              },
            }
          : {}),
      });
    };

    const guardScrollTarget = (line: number) => {
      const release = holdScrollTarget(
        scrollContainer,
        // CodeView's file element holds only its mounted rows, so only a mounted row places the line.
        () =>
          scroller === "codeView" &&
          !(fileContainer.shadowRoot ?? fileContainer).querySelector(`[data-line="${line}"]`)
            ? null
            : resolveScrollTarget(line),
        () => {
          if (scroller === "codeView") state.revealedScrollTop = scrollContainer.scrollTop;
        },
      );
      state.cancelGuard = () => {
        release();
        state.cancelGuard = null;
      };
    };

    const scheduleReveal = (attempt: number) => {
      state.frameId = requestAnimationFrame(() => {
        state.frameId = null;
        if (state.latestRequestId !== revealRequestId || !fileContainer.isConnected) {
          return;
        }

        // Wait for contents and metrics; missing data would clamp fresh-mount reveals to line 1 and mark them
        // handled.
        const currentContents = instance.file?.contents;
        const line =
          currentContents === undefined ? null : clampFileLine(currentContents, revealLine);
        const targetTop = line === null ? null : resolveScrollTarget(line);
        if (line === null || targetTop === null) {
          if (attempt < REVEAL_MAX_ATTEMPTS) scheduleReveal(attempt + 1);
          return;
        }
        updateFileLinkReveal(fileContainer, line);

        state.handledRequestId = revealRequestId;
        if (scroller === "codeView") {
          // That window's geometry cannot place the line, so the viewer scrolls to it.
          // It centers its estimate of the line, and rows it mounts on arrival can still move it.
          instance.scrollToLine(line, "center", (result) => {
            if (result !== "settled") return;
            state.revealedScrollTop = scrollContainer.scrollTop;
            guardScrollTarget(line);
          });
          return;
        }
        scrollContainer.scrollTop = targetTop;
        guardScrollTarget(line);
      });
    };

    scheduleReveal(0);
  };
}

const EMPTY_REVIEW_COMMENTS: ReadonlyArray<ReviewCommentContext> = [];

const createFileEditor: EditorFactory<FileCommentAnnotationGroup, undefined> = (
  editorType,
  options,
  editStateKey,
) => new Editor(editorType, options, editStateKey);
type FileEditor = Editor<"file", FileCommentAnnotationGroup, undefined>;

function editableFileContents(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string,
  contents: string,
): FileContents {
  return {
    name: relativePath,
    contents,
    cacheKey: `editor:${environmentId}:${projectFileCacheKey(cwd, relativePath, contents)}`,
  };
}

interface EditableFileSurfaceProps {
  environmentId: EnvironmentId;
  projectId?: ProjectId | undefined;
  cwd: string;
  relativePath: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  contents: string;
  resolvedTheme: "light" | "dark";
  revealRequestId: number;
  wordWrap: boolean;
  onPostRender: FilePostRender;
  onPendingChange: (relativePath: string, pending: boolean) => void;
  onEditorChange: (editor: FileEditor | null) => void;
}

interface FileSelectionOverride {
  revealRequestId: number;
  range: SelectedLineRange | null;
}

function EditableFileSurface({
  environmentId,
  projectId,
  cwd,
  relativePath,
  composerDraftTarget,
  contents,
  resolvedTheme,
  revealRequestId,
  wordWrap,
  onPostRender,
  onPendingChange,
  onEditorChange,
}: EditableFileSurfaceProps) {
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const removeReviewComment = useComposerDraftStore((store) => store.removeReviewComment);
  const reviewComments = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.reviewComments ?? EMPTY_REVIEW_COMMENTS,
  );
  const promptCommentIds = new Set(reviewComments.map((comment) => comment.id));
  // Saved comments live in the composer draft so they survive this surface remounting.
  const [draftEntry, setDraftEntry] = useState<FileCommentAnnotationEntry | null>(null);
  // Kept out of lineAnnotations, whose draft entries the edit remap treats as the new comment.
  const [editingComment, setEditingComment] = useState<{ id: string; text: string } | null>(null);
  const savedEntries = reviewComments
    .filter((comment) => comment.sectionId === `file:${relativePath}`)
    .map<FileCommentAnnotationEntry>((comment) => ({
      id: comment.id,
      kind: "comment",
      startLine: comment.startIndex + 1,
      endLine: comment.endIndex + 1,
      text: comment.text,
    }));
  const lineAnnotations = groupFileCommentEntries(
    draftEntry ? [...savedEntries, draftEntry] : savedEntries,
  );
  const [selectionOverride, setSelectionOverride] = useState<FileSelectionOverride | null>(null);
  const selectedRange =
    selectionOverride?.revealRequestId === revealRequestId ? selectionOverride.range : null;
  const setSelectedRange = (range: SelectedLineRange | null) => {
    setSelectionOverride({ revealRequestId, range });
  };
  const surfaceRef = useRef<HTMLDivElement>(null);
  const selectionFrameRef = useRef<number | null>(null);
  const saveTarget = { environmentId, cwd, relativePath };
  useFileSaveSession(saveTarget, onPendingChange);
  // Retain file identity for echoed editor changes; only external changes replace the editor's draft.
  const [externalFile, setExternalFile] = useState(() =>
    editableFileContents(environmentId, cwd, relativePath, contents),
  );
  const [editedContents, setEditedContents] = useState<string | null>(null);
  if (contents !== (editedContents ?? externalFile.contents)) {
    setExternalFile(editableFileContents(environmentId, cwd, relativePath, contents));
    setEditedContents(null);
  }
  const { ready: editable, onPostRender: onEditablePostRender } =
    useEditableAfterHighlight(externalFile);
  const editorRef = useRef<FileEditor | null>(null);
  const editorOptions: EditorOptions<"file", FileCommentAnnotationGroup, undefined> = {
    onAttach: (editor) => {
      editorRef.current = editor;
      onEditorChange(editor);
    },
    onComplete: () => {
      editorRef.current = null;
      onEditorChange(null);
    },
  };

  const handleEditChange = ({
    file,
    lineAnnotations: nextLineAnnotations,
  }: EditorChangeEvent<"file", FileCommentAnnotationGroup, undefined>) => {
    if (file.contents === getProjectFileContents(environmentId, cwd, relativePath)) return;
    setEditedContents(file.contents);
    setProjectFileQueryData(environmentId, cwd, relativePath, file.contents);
    changeFileSaveSession(saveTarget, file.contents);
    if (!nextLineAnnotations) return;
    const remapped = remapFileCommentAnnotations(nextLineAnnotations);
    for (const annotation of remapped) {
      for (const entry of annotation.metadata.entries) {
        if (entry.kind === "draft") {
          setDraftEntry(entry);
          continue;
        }
        if (entry.kind !== "comment" || !promptCommentIds.has(entry.id)) continue;
        addReviewComment(
          composerDraftTarget,
          buildFileReviewComment({
            id: entry.id,
            filePath: relativePath,
            startLine: entry.startLine,
            endLine: entry.endLine,
            text: entry.text,
            contents: file.contents,
          }),
        );
      }
    }
  };

  const removeAnnotationEntry = (entryId: string) => {
    setSelectedRange(null);
    if (draftEntry?.id === entryId) setDraftEntry(null);
    else if (editingComment?.id === entryId) setEditingComment(null);
    else removeReviewComment(composerDraftTarget, entryId);
  };

  const submitAnnotationEntry = (entryId: string, text: string) => {
    setSelectedRange(null);
    if (editingComment?.id === entryId) {
      const comment = reviewComments.find((candidate) => candidate.id === entryId);
      if (comment) {
        addReviewComment(composerDraftTarget, { ...comment, text }, { appendReference: false });
      }
      setEditingComment(null);
      return;
    }
    if (draftEntry?.id !== entryId) return;
    addReviewComment(
      composerDraftTarget,
      buildFileReviewComment({
        id: draftEntry.id,
        filePath: relativePath,
        startLine: draftEntry.startLine,
        endLine: draftEntry.endLine,
        text,
        contents,
      }),
    );
    setDraftEntry(null);
  };

  const beginComment = (range: SelectedLineRange) => {
    editorRef.current?.setSelections([]);
    editorRef.current?.blur();
    const { startLine, endLine } = normalizeFileCommentRange(range);
    setDraftEntry({ id: nextFileCommentId(), kind: "draft", startLine, endLine, text: "" });
  };
  const beginEdit = (entry: FileCommentAnnotationEntry) => {
    editorRef.current?.setSelections([]);
    editorRef.current?.blur();
    setSelectedRange(null);
    setEditingComment({ id: entry.id, text: entry.text });
  };
  const hasOpenCommentForm =
    draftEntry !== null || reviewComments.some((comment) => comment.id === editingComment?.id);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- installs selection dismissal listeners on the editor surface DOM node
  useEffect(() => {
    const root = surfaceRef.current;
    if (!root) return;
    return installFileEditorDismissal({
      root,
      editor: { setSelections: (selections) => editorRef.current?.setSelections(selections) },
      isBlocked: () => hasOpenCommentForm,
      onDismiss: () => setSelectedRange(null),
    });
  }, [hasOpenCommentForm, setSelectedRange]);
  const handleLineSelectionEnd = (range: SelectedLineRange | null) => {
    setSelectedRange(range);
    if (range) {
      beginComment(range);
    }
  };

  const handlePostRender: FilePostRender = (fileContainer, instance, phase) => {
    onPostRender(fileContainer, instance, phase);
    onEditablePostRender(instance.file, phase);

    if (selectionFrameRef.current !== null) {
      cancelAnimationFrame(selectionFrameRef.current);
      selectionFrameRef.current = null;
    }
    if (phase === "unmount") return;

    selectionFrameRef.current = requestAnimationFrame(() => {
      selectionFrameRef.current = null;
      if (!fileContainer.isConnected) return;
      instance.setSelectedLines(selectedRange, { notify: false });
    });
  };

  return (
    <EditProvider createEditor={createFileEditor}>
      <div ref={surfaceRef} className="flex min-h-0 flex-1">
        <Virtualizer
          className="file-preview-virtualizer min-h-0 flex-1 overflow-auto"
          config={{
            overscrollSize: 600,
            intersectionObserverMargin: 1200,
          }}
        >
          <File<FileCommentAnnotationGroup>
            file={externalFile}
            edit={editable}
            editorOptions={editorOptions}
            onEditChange={handleEditChange}
            options={{
              disableFileHeader: true,
              enableGutterUtility: !hasOpenCommentForm,
              enableLineSelection: !hasOpenCommentForm,
              onGutterUtilityClick: setSelectedRange,
              onLineSelectionChange: setSelectedRange,
              onLineSelectionEnd: handleLineSelectionEnd,
              overflow: wordWrap ? "wrap" : "scroll",
              theme: resolveDiffThemeName(resolvedTheme),
              preferredHighlighter: PREFERRED_HIGHLIGHTER,
              themeType: resolvedTheme,
              unsafeCSS: FILE_LINK_REVEAL_UNSAFE_CSS,
              onPostRender: handlePostRender,
            }}
            selectedLines={selectedRange}
            lineAnnotations={lineAnnotations}
            renderAnnotation={(annotation) => {
              // Sent comments stay annotated so a failed send can restore them at remapped lines.
              const entries = promptFileCommentEntries(
                annotation.metadata.entries,
                promptCommentIds,
              );
              if (entries.length === 0) return null;
              return (
                <div className="py-1">
                  {entries.map((entry) => {
                    const editing = editingComment?.id === entry.id ? editingComment : null;
                    return (
                      <DiffCommentAnnotation
                        key={entry.id}
                        environmentId={environmentId}
                        projectId={projectId}
                        ownerKey={JSON.stringify([
                          environmentId,
                          composerDraftTarget,
                          relativePath,
                          entry.id,
                        ])}
                        kind={editing ? "draft" : entry.kind}
                        rangeLabel={formatFileCommentRange(entry.startLine, entry.endLine)}
                        text={editing ? editing.text : entry.text}
                        onCancel={() => removeAnnotationEntry(entry.id)}
                        onComment={(text) => submitAnnotationEntry(entry.id, text)}
                        onDelete={() => removeAnnotationEntry(entry.id)}
                        {...(editing
                          ? {
                              submitLabel: m(msg("Save")),
                              onTextChange: (text: string) =>
                                setEditingComment({ id: entry.id, text }),
                            }
                          : {})}
                        {...(hasOpenCommentForm ? {} : { onEdit: () => beginEdit(entry) })}
                      />
                    );
                  })}
                </div>
              );
            }}
            className="min-h-full"
          />
        </Virtualizer>
      </div>
    </EditProvider>
  );
}

function selectRenderedContentOnSelectAll(event: ReactKeyboardEvent<HTMLElement>) {
  const mac = isMacPlatform(navigator.platform);
  const selectAll =
    event.key.toLowerCase() === "a" &&
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
    !event.shiftKey &&
    !event.altKey;
  // React bubbles keys from portaled children (the image dialog) through this surface.
  if (
    !selectAll ||
    !(event.target instanceof Node) ||
    !event.currentTarget.contains(event.target)
  ) {
    return;
  }
  event.preventDefault();
  window.getSelection()?.selectAllChildren(event.currentTarget);
}

function RenderedMarkdownSurface({
  environmentId,
  cwd,
  relativePath,
  contents,
  threadRef,
  workspaceMutationId,
  readOnly,
  onPendingChange,
  onDiagramComment,
  composerDraftTarget,
}: Omit<
  EditableFileSurfaceProps,
  | "resolvedTheme"
  | "revealLine"
  | "revealRequestId"
  | "wordWrap"
  | "onPostRender"
  | "onEditorChange"
> & {
  threadRef: ScopedThreadRef;
  readOnly: boolean;
  workspaceMutationId: string | null;
  onDiagramComment?:
    | ((diagramSource: string, section: DiagramSection | null, text: string) => void)
    | undefined;
}) {
  const saveTarget = { environmentId, cwd, relativePath };
  useFileSaveSession(saveTarget, onPendingChange);
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const [markdownViewport, setMarkdownViewport] = useState<HTMLDivElement | null>(null);
  const [findContainer, setFindContainer] = useState<HTMLDivElement | null>(null);
  const find = useMarkdownFind(findContainer);

  return (
    <div
      ref={setMarkdownViewport}
      className="relative min-h-0 flex-1 outline-none"
      data-markdown-find-scope="true"
      tabIndex={0}
      onKeyDownCapture={find.onKeyDownCapture}
    >
      <ScrollArea className="min-h-0 flex-1" onKeyDown={selectRenderedContentOnSelectAll}>
        <div ref={setFindContainer}>
          <FileMarkdownPreview
            text={contents}
            cwd={cwd}
            relativePath={relativePath}
            threadRef={threadRef}
            workspaceMutationId={workspaceMutationId}
            onDiagramComment={onDiagramComment}
            onTaskListChange={
              readOnly
                ? undefined
                : ({ markerOffset, checked }) => {
                    const currentContents =
                      getOptimisticProjectFileQueryData(environmentId, cwd, relativePath)
                        ?.contents ?? contents;
                    const nextContents = setMarkdownTaskChecked(
                      currentContents,
                      markerOffset,
                      checked,
                    );
                    if (nextContents === currentContents) return;
                    setProjectFileQueryData(environmentId, cwd, relativePath, nextContents);
                    changeFileSaveSession(saveTarget, nextContents);
                  }
            }
          />
        </div>
      </ScrollArea>
      {find.open ? (
        <div className="absolute top-2 right-3 z-40">
          <MarkdownFindBar
            query={find.query}
            matchCount={find.matchCount}
            activeIndex={find.activeIndex}
            focusToken={find.focusToken}
            onQueryChange={find.setQuery}
            onNext={find.next}
            onPrevious={find.previous}
            onClose={find.close}
          />
        </div>
      ) : null}
      {markdownViewport ? (
        <MarkdownViewCommentToolbar
          viewport={markdownViewport}
          contents={contents}
          onComment={({ startLine, endLine, text }) =>
            addReviewComment(
              composerDraftTarget,
              buildFileReviewComment({
                id: nextFileCommentId(),
                filePath: relativePath,
                startLine,
                endLine,
                text,
                contents,
              }),
            )
          }
        />
      ) : null}
    </div>
  );
}

function renderedToggleLabel(
  mode: "markdown" | "mermaid" | "html" | "table" | "diagrams",
  rendered: boolean,
  diagramCount = 0,
): string {
  if (mode === "mermaid")
    return rendered ? m(msg("Show Mermaid source")) : m(msg("Show rendered diagram"));
  if (mode === "markdown")
    return rendered ? m(msg("Show markdown source")) : m(msg("Show rendered markdown"));
  if (mode === "table") return rendered ? m(msg("Show source")) : m(msg("Show table"));
  if (mode === "diagrams")
    return rendered
      ? m(msg("Show source"))
      : m(msg("Show diagrams ({diagramCount})", { diagramCount: diagramCount }));
  return rendered ? m(msg("Show HTML source")) : m(msg("Show rendered page"));
}

function initialExplorerOpen(): boolean {
  try {
    return getLocalStorageItem(FILE_EXPLORER_STORAGE_KEY, Schema.Boolean) ?? true;
  } catch (error) {
    console.error(error);
    return true;
  }
}

export default function FilePreviewPanel({
  environmentId,
  cwd,
  projectName,
  projectId,
  relativePath: requestedPath,
  attachment,
  threadRef,
  composerDraftTarget,
  keybindings,
  availableEditors,
  openInShortcutEnabled,
  revealLine,
  revealRequestId,
  onOpenFile,
  onNavigateFolder,
  folderTrail,
  onPendingChange,
  selectedFilePending,
  workspaceMutationId,
}: FilePreviewPanelProps) {
  const gt = useGT();
  const relativePath =
    attachment === undefined ? resolveFilePreviewPath(requestedPath, cwd) : requestedPath;
  const draft = typeof composerDraftTarget === "string";
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  // Sends a comment on a marked diagram section to the chat composer as a review
  // comment anchored to the section's line in the source file.
  const handleDiagramComment = (
    path: string,
    contents: string,
    block: { readonly startLine: number; readonly endLine: number },
    section: DiagramSection | null,
    text: string,
  ) => {
    const lines = section
      ? findDiagramSectionLines({
          contents,
          sectionId: section.id,
          blockStartLine: block.startLine,
          blockEndLine: block.endLine,
        })
      : { startLine: block.startLine, endLine: block.endLine };
    addReviewComment(
      composerDraftTarget,
      buildDiagramReviewComment({
        id: nextFileCommentId(),
        filePath: path,
        startLine: lines.startLine,
        endLine: lines.endLine,
        sectionLabel: diagramSectionLabel(section),
        text,
        contents,
      }),
    );
  };
  const { resolvedTheme } = useTheme();
  const defaultWordWrap = useClientSettings((settings) => settings.wordWrap);
  const [wordWrapOverride, setWordWrapOverride] = useState<boolean | null>(null);
  const wordWrap = wordWrapOverride ?? defaultWordWrap;
  const canOperatePreview = useEnvironmentScope(environmentId, AuthPreviewOperateScope);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const hostEnvironmentId = useAtomValue(hostEnvironmentIdAtom);
  const remoteOpenState = useRemoteOpenState(environmentId);
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const environmentHttpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const previewAvailable = usePreviewAvailable(environmentId);
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  const openPreview = useAtomCommand(previewEnvironment.open, {
    reportFailure: false,
  });
  const isVideo = relativePath !== null && isWorkspaceVideoPreviewPath(relativePath);
  const isAudio = relativePath !== null && !isVideo && isWorkspaceAudioPreviewPath(relativePath);
  const isImage = relativePath !== null && !isVideo && isWorkspaceImagePreviewPath(relativePath);
  const isMedia = isImage || isVideo || isAudio;
  const isPdf = relativePath !== null && isPdfPreviewFile(relativePath);
  const isDocument =
    relativePath !== null &&
    (binaryPreviewKind({ name: relativePath }) !== null ||
      officePreviewKind({ name: relativePath }) !== null ||
      isWorkspaceFontPreviewPath(relativePath));
  const isHtml = relativePath !== null && !isPdf && isBrowserPreviewFile(relativePath);
  const isHostFile =
    attachment !== undefined || (relativePath !== null && isHostPath(relativePath));
  const fileAccess = useFilesystemReadAccess(environmentId);
  const { canReadFiles } = fileAccess;
  const canWriteFiles = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const file = useProjectFileQuery(
    environmentId,
    cwd,
    relativePath,
    attachment === undefined && relativePath !== null,
  );
  const [fileRefreshRevision, setFileRefreshRevision] = useState(0);
  const attemptedPath = file.readError?.resolvedPath ?? file.readError?.operationPath;
  // Folder links fail file reads; retain mutation refresh to detect conversion to files. Host folders own
  // roots; folderTrail keeps descendants.
  const breadcrumbPath =
    attachment !== undefined ? null : (relativePath ?? (folderTrail === undefined ? null : ""));
  // Reset crumbs when a host trail reaches the workspace root and no longer passes through the current path.
  const breadcrumbTrail =
    breadcrumbPath === null ? null : retainedBreadcrumbTrail(folderTrail, breadcrumbPath);
  // A trail implies a folder before reads settle, preventing file-preview flashes while navigating up.
  const isFolder =
    attachment === undefined &&
    (file.isNotFile || (folderTrail !== undefined && file.data === null && file.error === null));
  const hostFolderPath = isFolder && isHostFile ? relativePath : null;
  // A chat-linked folder reads as a file until its read settles, and a trail only implies a folder.
  const fileManagerAction = fileManagerActionForPath({
    isFolder: relativePath === null || file.isNotFile,
    isSettled: file.data !== null || file.error !== null,
    canReveal: serverConfig?.shellRevealInFileManager === true,
  });
  // Everything preview-related keys off previewPath; a folder has no preview.
  const previewPath = isFolder ? null : relativePath;
  const [explorerOpen, setExplorerOpen] = useState(initialExplorerOpen);
  const showExplorer = shouldShowFileExplorer({
    relativePath: previewPath,
    explorerOpen,
    attachmentOpen: attachment !== undefined,
  });
  const [renderMarkdownPreferred, setRenderMarkdownPreferred] = useLocalStorage(
    RENDER_MARKDOWN_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const [renderBrowserFilePreferred, setRenderBrowserFilePreferred] = useLocalStorage(
    RENDER_BROWSER_FILE_STORAGE_KEY,
    true,
    Schema.Boolean,
  );
  const [renderTablePreferred, setRenderTablePreferred] = useLocalStorage(
    RENDER_TABLE_STORAGE_KEY,
    true,
    Schema.Boolean,
  );
  // Reveal ids restart at one per file; pair with the path so dismissal cannot swallow another file's reveal.
  const [handledReveal, setHandledReveal] = useState<{ path: string; requestId: number } | null>(
    null,
  );
  const breadcrumbRef = useRef<HTMLDivElement>(null);
  const isMarkdown = previewPath ? isMarkdownPreviewFile(previewPath) : false;
  const isMermaid = previewPath !== null && /\.(mmd|mermaid)$/i.test(previewPath);
  const [renderMermaidPreferred, setRenderMermaidPreferred] = useLocalStorage(
    "t3code.renderMermaid",
    true,
    Schema.Boolean,
  );
  const tableDelimiter =
    previewPath && attachment === undefined ? filePreviewDelimiter({ name: previewPath }) : null;
  const [renderDiagramsPreferred, setRenderDiagramsPreferred] = useLocalStorage(
    RENDER_DIAGRAMS_STORAGE_KEY,
    true,
    Schema.Boolean,
  );
  // Mermaid blocks embedded in a source file (e.g. fenced blocks in JS/TS doc
  // comments). Markdown and mermaid files already render their diagrams inline.
  const mermaidBlocks: MermaidCodeBlock[] =
    file.data !== null &&
    !isMermaid &&
    !isMarkdown &&
    tableDelimiter === null &&
    !isHtml &&
    !isDocument &&
    !isMedia
      ? extractMermaidCodeBlocks(file.data.contents)
      : [];
  const revealHandled =
    revealLine === null ||
    (handledReveal?.path === relativePath && handledReveal.requestId === revealRequestId);
  const markdownRenderable = isMarkdown && (file.data?.byteLength ?? 0) <= FULL_TEXT_MAX_BYTES;
  const renderMarkdown = markdownRenderable && renderMarkdownPreferred && revealHandled;
  const renderMermaid = isMermaid && renderMermaidPreferred && revealHandled;
  const renderBrowserFile = isPdf || (isHtml && renderBrowserFilePreferred && revealHandled);
  const renderTable = tableDelimiter !== null && renderTablePreferred && revealHandled;
  const renderDiagrams = mermaidBlocks.length > 0 && renderDiagramsPreferred && revealHandled;
  const renderedMode = isMermaid
    ? ("mermaid" as const)
    : isMarkdown
      ? ("markdown" as const)
      : tableDelimiter
        ? ("table" as const)
        : isHtml
          ? ("html" as const)
          : mermaidBlocks.length > 0
            ? ("diagrams" as const)
            : null;
  const canToggleRendered =
    previewPath !== null &&
    attachment === undefined &&
    renderedMode !== null &&
    (!isMarkdown || markdownRenderable);
  const showsRawText =
    previewPath !== null &&
    file.data !== null &&
    !(isMarkdown && renderMarkdown) &&
    !renderMermaid &&
    !(tableDelimiter && renderTable) &&
    !renderBrowserFile &&
    !renderDiagrams &&
    !isDocument;
  const mayOpenEditor =
    previewPath !== null &&
    !isHostFile &&
    canWriteFiles &&
    file.error === null &&
    !file.data?.truncated &&
    !isMedia &&
    !isDocument &&
    !renderBrowserFile &&
    !renderMermaid &&
    !(isMarkdown && renderMarkdown) &&
    !(tableDelimiter && renderTable);
  const copyableContents =
    previewPath !== null &&
    !isMedia &&
    !isDocument &&
    !isPdf &&
    file.data &&
    !file.data.truncated &&
    file.data.contents.length > 0
      ? file.data.contents
      : null;
  const showsLargeText =
    previewPath !== null &&
    attachment === undefined &&
    !isMedia &&
    !renderBrowserFile &&
    !isDocument &&
    !renderMermaid &&
    file.data?.truncated === true;
  const copyLargeText = useRef<(() => Promise<string>) | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: namedClipboardTarget(previewPath ?? ""),
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: gt("Could not copy file"),
        description: error.message,
      }),
  });
  const contentFocusRef = useRef<HTMLDivElement>(null);
  const fileEditorRef = useRef<FileEditor | null>(null);
  const focusEditorFromContent = () => {
    const editor = fileEditorRef.current;
    if (!editor || document.activeElement !== contentFocusRef.current) return;
    // Without a caret the editor focuses with no selection, so no caret shows and typing
    // lands on whatever the browser selection held.
    const hasCaret = Boolean(editor.getViewState().selections?.length);
    editor.focus(
      hasCaret
        ? { preventScroll: true }
        : { preventScroll: true, lineNumber: revealLine ?? "first-visible" },
    );
  };
  const handleEditorChange = (editor: FileEditor | null) => {
    fileEditorRef.current = editor;
    focusEditorFromContent();
  };
  const handleEditorChangeStable = useStableCallback(handleEditorChange);
  const focusEditorOnTreeRowClickOrEnter = (event: {
    nativeEvent: Event;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const row = event.nativeEvent
      .composedPath()
      .find(
        (node): node is Element =>
          node instanceof Element && node.matches('[role="treeitem"][data-item-path]'),
      );
    const path = row?.getAttribute("data-item-path");
    if (!path || path.endsWith("/")) return;
    requestWorkspaceFocus({ area: "panel", selector: "[data-file-content-focus]" });
  };
  const rendered = isMermaid
    ? renderMermaid
    : isMarkdown
      ? renderMarkdown
      : tableDelimiter
        ? renderTable
        : isHtml
          ? renderBrowserFile
          : renderDiagrams;
  const setRenderedPreferred = isMermaid
    ? setRenderMermaidPreferred
    : isMarkdown
      ? setRenderMarkdownPreferred
      : tableDelimiter
        ? setRenderTablePreferred
        : isHtml
          ? setRenderBrowserFilePreferred
          : setRenderDiagramsPreferred;
  const canOpenInBrowser =
    canOperatePreview &&
    previewPath !== null &&
    attachment === undefined &&
    !isVideo &&
    previewAvailable &&
    isBrowserPreviewFile(previewPath);
  // Navigating up preserves the file tab; retain the trail's path spelling to find its folder tab.
  const navigateToFolder = (crumbPath: string) => {
    const path =
      breadcrumbTrail !== null && breadcrumbPathOf(breadcrumbTrail) === crumbPath
        ? breadcrumbTrail
        : crumbPath;
    onNavigateFolder(path, retainedBreadcrumbTrail(breadcrumbTrail ?? undefined, path), !isFolder);
  };
  const absolutePath =
    breadcrumbPath === ""
      ? cwd
      : relativePath && attachment === undefined
        ? resolvePathLinkTarget(relativePath, cwd)
        : null;

  const onFilePostRender = useFileLineReveal(
    relativePath === null
      ? null
      : `${environmentId}:${attachment ? `attachment:${attachment.id}` : cwd}:${relativePath}`,
    relativePath,
    revealLine,
    revealRequestId,
  );

  // Mounting the file read under the workspace mutation id refetches it after each mutation.
  useAtomMount(
    canReadFiles &&
      attachment === undefined &&
      relativePath !== null &&
      // Skip mutation reads for media and documents; folders still detect conversion to files.
      (isFolder || (!isMedia && !isPdf && !isDocument)) &&
      !selectedFilePending
      ? revisionedQuery(
          getProjectFileQueryAtom(environmentId, cwd, relativePath),
          workspaceMutationId,
        )
      : NO_FILE_REVISION_ATOM,
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the breadcrumb DOM so the deepest and current crumbs are in view after commit
  useEffect(() => {
    const crumbs = breadcrumbRef.current?.querySelectorAll<HTMLElement>("[data-file-crumb]");
    // Show the deepest crumb when it fits, but never at the cost of the current one.
    crumbs?.[crumbs.length - 1]?.scrollIntoView({ block: "nearest", inline: "end" });
    breadcrumbRef.current
      ?.querySelector<HTMLElement>("[data-current-file-crumb='true']")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A new path or trail re-renders the crumbs, so the current one scrolls back into view.
  }, [breadcrumbPath, breadcrumbTrail]);

  const toggleExplorer = () => {
    setExplorerOpen((current) => {
      const next = !current;
      try {
        setLocalStorageItem(FILE_EXPLORER_STORAGE_KEY, next, Schema.Boolean);
      } catch (error) {
        console.error(error);
      }
      return next;
    });
  };

  const handleOpenInBrowser = () => {
    if (!canReadFiles || !canOperatePreview || !absolutePath || !environmentHttpBaseUrl) return;
    void (async () => {
      const result = await openFileInPreview({
        threadRef,
        filePath: absolutePath,
        workspaceRoot: cwd,
        httpBaseUrl: environmentHttpBaseUrl,
        createAssetUrl,
        openPreview,
      });
      if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
        return;
      }
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: m(msg("Unable to open file in browser")),
          description: error instanceof Error ? error.message : m(msg("An error occurred.")),
        }),
      );
    })();
  };

  if (attachment === undefined && !canReadFiles) {
    if (fileAccess.isPending) {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          <T>Checking file access...</T>
        </div>
      );
    }
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {fileAccess.error ?? m(msg("This connection cannot read host files."))}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {breadcrumbPath !== null && breadcrumbTrail !== null ? (
        <div className={FILE_SURFACE_SUBHEADER_CLASS} data-surface-subheader>
          <ScrollArea
            radius="none"
            ref={breadcrumbRef}
            hideScrollbars
            scrollFade
            className="min-w-0 flex-1"
            data-file-breadcrumbs
          >
            <div className="flex h-full w-max min-w-full items-center text-xs">
              <FileBreadcrumbs
                cwd={cwd}
                environmentId={environmentId}
                onNavigateFolder={navigateToFolder}
                onOpenFile={onOpenFile}
                projectName={projectName}
                relativePath={breadcrumbPath}
                trail={breadcrumbTrail}
                workspaceMutationId={workspaceMutationId}
              />
            </div>
          </ScrollArea>
          {absolutePath &&
          (environmentId === primaryEnvironmentId ||
            environmentId === hostEnvironmentId ||
            remoteOpenState.mode !== "local-exec") ? (
            <OpenInPicker
              environmentId={environmentId}
              keybindings={keybindings}
              availableEditors={availableEditors}
              enableShortcut={openInShortcutEnabled}
              openInCwd={absolutePath}
              openInCwdIsFile={file.isFile}
              compact
              fileManagerAction={fileManagerAction}
            />
          ) : null}
          {canToggleRendered && renderedMode ? (
            <FileSurfaceAction
              label={renderedToggleLabel(renderedMode, rendered, mermaidBlocks.length)}
              pressed={rendered}
              onPress={() => {
                const pressed = !rendered;
                setRenderedPreferred(pressed);
                setHandledReveal(
                  pressed && relativePath !== null
                    ? { path: relativePath, requestId: revealRequestId }
                    : null,
                );
              }}
            >
              {rendered ? (
                <Code2Icon className="size-3.5" />
              ) : renderedMode === "table" ? (
                <Table2Icon className="size-3.5" />
              ) : (
                <EyeIcon className="size-3.5" />
              )}
            </FileSurfaceAction>
          ) : null}
          {showsRawText ? (
            <FileSurfaceAction
              label={wordWrap ? m(msg("Disable word wrap")) : m(msg("Enable word wrap"))}
              pressed={wordWrap}
              onPress={() => setWordWrapOverride(!wordWrap)}
            >
              <WrapTextIcon className="size-3.5" />
            </FileSurfaceAction>
          ) : null}
          {copyableContents !== null ? (
            <FileSurfaceAction
              label={isCopied ? gt("Copied") : gt("Copy contents")}
              onPress={() => copyToClipboard(copyableContents, undefined)}
            >
              {isCopied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
            </FileSurfaceAction>
          ) : null}
          {showsLargeText && absolutePath && relativePath ? (
            <LargeFileActions
              environmentId={environmentId}
              threadRef={threadRef}
              absolutePath={absolutePath}
              draftCwd={draft ? cwd : null}
              name={relativePath}
              copyContents={copyLargeText}
            />
          ) : null}
          {canOpenInBrowser ? (
            <FileSurfaceAction
              label={msg("Open file in preview browser")}
              onPress={handleOpenInBrowser}
            >
              <Globe2 className="size-3.5" />
            </FileSurfaceAction>
          ) : null}
          {!isHostFile && previewPath !== null ? (
            <FileSurfaceAction
              label={explorerOpen ? m(msg("Hide file explorer")) : m(msg("Show file explorer"))}
              pressed={explorerOpen}
              onPress={toggleExplorer}
            >
              <FolderTree className="size-3.5" />
            </FileSurfaceAction>
          ) : null}
        </div>
      ) : null}
      {relativePath && !attachment && !isHostFile && !canWriteFiles && !fileAccess.isPending ? (
        <div className="shrink-0 border-b px-3 py-1.5 text-2xs text-muted-foreground">
          <T>Read-only connection. Unsaved edits are kept until write access returns.</T>
        </div>
      ) : null}
      {previewPath &&
      attachment === undefined &&
      !isMedia &&
      !renderBrowserFile &&
      file.data?.truncated &&
      (draft || isMarkdown || isMermaid || isHtml || renderDiagrams) ? (
        <div className="shrink-0 border-b border-warning/20 bg-warning-surface px-3 py-1.5 text-2xs text-warning-foreground">
          <T>Preview limited to the first 1 MB of a </T>
          {file.data.byteLength.toLocaleString()} <T>byte file.</T>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={cn("min-w-0 flex-1 flex-col overflow-hidden", previewPath ? "flex" : "hidden")}
        >
          {mayOpenEditor ? (
            // Panel focus lands here and passes to the editor once it attaches. sr-only keeps the
            // 1px box workspace focus needs, and clips it so clicks in the file never reach it.
            // The hand-off waits a microtask: workspace focus checks that focus stayed here.
            <div
              ref={contentFocusRef}
              tabIndex={-1}
              data-workspace-focus-default
              data-file-content-focus
              aria-label={msg("File contents")}
              className="sr-only"
              onFocus={() => queueMicrotask(focusEditorFromContent)}
            />
          ) : null}
          {isFolder ? null : relativePath && attachment ? (
            <AttachmentFilePreview
              key={`${environmentId}:${attachment.id}`}
              name={attachment.name}
              mimeType={attachment.mimeType}
              sizeBytes={attachment.sizeBytes}
              asset={{ environmentId, attachmentId: attachment.id }}
              htmlRender={attachment.htmlRender === true}
              threadRef={threadRef}
            />
          ) : relativePath && isVideo && absolutePath ? (
            <WorkspaceVideoPreview
              key={`${environmentId}:${threadRef.threadId}:${absolutePath}`}
              environmentId={environmentId}
              threadRef={threadRef}
              draft={draft}
              absolutePath={absolutePath}
              workspaceRoot={cwd}
              name={relativePath}
              workspaceMutationId={workspaceMutationId}
            />
          ) : relativePath && isAudio && absolutePath ? (
            <WorkspaceAudioPreview
              key={`${environmentId}:${threadRef.threadId}:${absolutePath}`}
              environmentId={environmentId}
              threadRef={threadRef}
              draft={draft}
              absolutePath={absolutePath}
              workspaceRoot={cwd}
              name={relativePath}
              workspaceMutationId={workspaceMutationId}
            />
          ) : relativePath && isImage && absolutePath ? (
            <WorkspaceImagePreview
              key={absolutePath}
              environmentId={environmentId}
              threadRef={threadRef}
              draft={draft}
              absolutePath={absolutePath}
              workspaceRoot={cwd}
              alt={relativePath}
              workspaceMutationId={workspaceMutationId}
            />
          ) : relativePath && renderBrowserFile && absolutePath ? (
            <WorkspaceBrowserPreview
              key={absolutePath}
              environmentId={environmentId}
              threadRef={threadRef}
              draft={draft}
              absolutePath={absolutePath}
              workspaceRoot={cwd}
              title={relativePath}
              workspaceMutationId={workspaceMutationId}
            />
          ) : relativePath &&
            absolutePath &&
            file.data?.truncated &&
            !isDocument &&
            !draft &&
            !isMarkdown &&
            !isMermaid &&
            !isHtml &&
            !renderDiagrams ? (
            <WorkspaceLargeTextPreview
              key={`${absolutePath}:${renderTable}:${renderMarkdown}:${fileRefreshRevision}`}
              environmentId={environmentId}
              threadRef={threadRef}
              absolutePath={absolutePath}
              draftCwd={draft ? cwd : null}
              name={relativePath}
              delimiter={renderTable ? tableDelimiter : null}
              markdownCwd={renderMarkdown ? cwd : null}
              copyContents={copyLargeText}
              preview={file.data?.contents ?? ""}
              sizeBytes={file.data?.byteLength ?? 0}
              onPostRender={onFilePostRender("codeView")}
              workspaceMutationId={workspaceMutationId}
              revealLine={revealLine}
              revealRequestId={revealRequestId}
              wordWrap={wordWrap}
            />
          ) : relativePath &&
            absolutePath &&
            (isDocument || file.readError?.failure === "binary_file") ? (
            <WorkspaceDocumentPreview
              key={`${environmentId}:${absolutePath}`}
              environmentId={environmentId}
              threadRef={threadRef}
              draft={draft}
              document={isDocument}
              absolutePath={absolutePath}
              workspaceRoot={cwd}
              name={relativePath.split(/[\\/]/).at(-1) || relativePath}
              workspaceMutationId={workspaceMutationId}
              refreshRevision={fileRefreshRevision}
            />
          ) : relativePath && file.error && file.data === null ? (
            <div
              role="alert"
              className="scrollbar-gutter-both flex min-h-0 flex-1 flex-col overflow-auto"
            >
              <div className="my-auto flex shrink-0 flex-col gap-3 px-6 py-6 text-center text-xs leading-relaxed">
                <p className="text-destructive">
                  {file.readError ? filePreviewReadErrorMessage(file.readError) : file.error}
                </p>
                {attemptedPath ? (
                  <p className="text-muted-foreground">
                    <T>Attempted path</T>
                    <code className="block break-all font-mono text-foreground select-all">
                      {attemptedPath}
                    </code>
                  </p>
                ) : null}
                {!isHostFile ? (
                  <p className="text-muted-foreground">
                    <T>Workspace folder: </T>
                    <code className="break-all font-mono select-all">
                      {file.readError?.cwd ?? cwd}
                    </code>
                    <T>. Check the link's path or locate the file in Files.</T>
                  </p>
                ) : null}
              </div>
            </div>
          ) : relativePath && file.data === null ? (
            <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
              <Spinner size="lg" />
            </div>
          ) : relativePath && file.data ? (
            renderMermaid ? (
              <Suspense fallback={<FileSurfaceLoading />}>
                <MermaidFilePreview
                  text={file.data.contents}
                  onCommentSection={(section, text) => {
                    const contents = file.data?.contents ?? "";
                    handleDiagramComment(
                      relativePath,
                      contents,
                      { startLine: 1, endLine: contents.split("\n").length },
                      section,
                      text,
                    );
                  }}
                />
              </Suspense>
            ) : isMarkdown && renderMarkdown ? (
              <RenderedMarkdownSurface
                key={relativePath}
                environmentId={environmentId}
                cwd={cwd}
                relativePath={relativePath}
                threadRef={threadRef}
                contents={file.data.contents}
                workspaceMutationId={workspaceMutationId}
                readOnly={file.data.truncated || isHostFile || !canWriteFiles}
                onPendingChange={onPendingChange}
                composerDraftTarget={composerDraftTarget}
                onDiagramComment={(diagramSource, section, text) => {
                  const markdownContents = file.data?.contents ?? "";
                  // Anchor the comment to the fenced block in the file that matches the diagram.
                  const block = extractMermaidCodeBlocks(markdownContents).find((candidate) =>
                    mermaidSourcesMatch(candidate.source, diagramSource),
                  ) ?? {
                    source: diagramSource,
                    startLine: 1,
                    endLine: markdownContents.split("\n").length,
                  };
                  handleDiagramComment(relativePath, markdownContents, block, section, text);
                }}
              />
            ) : tableDelimiter && renderTable ? (
              <DelimitedTablePreview
                key={relativePath}
                name={relativePath}
                text={file.data.contents}
                delimiter={tableDelimiter}
              />
            ) : renderDiagrams ? (
              <Suspense fallback={<FileSurfaceLoading />}>
                <MermaidBlocksPreview
                  key={relativePath}
                  filePath={relativePath}
                  blocks={mermaidBlocks}
                  onCommentSection={(block, section, text) =>
                    handleDiagramComment(
                      relativePath,
                      file.data?.contents ?? "",
                      block,
                      section,
                      text,
                    )
                  }
                />
              </Suspense>
            ) : file.data.truncated || isHostFile || !canWriteFiles ? (
              <SourceFilePreview
                name={relativePath}
                text={file.data.contents}
                cacheKey={projectFileCacheKey(cwd, relativePath, file.data.contents)}
                onPostRender={onFilePostRender("codeView")}
                wordWrap={wordWrap}
              />
            ) : (
              <DiffWorkerPoolProvider>
                <EditableFileSurface
                  key={`${relativePath}:${resolvedTheme}`}
                  environmentId={environmentId}
                  projectId={projectId}
                  cwd={cwd}
                  relativePath={relativePath}
                  composerDraftTarget={composerDraftTarget}
                  contents={file.data.contents}
                  resolvedTheme={resolvedTheme}
                  revealRequestId={revealRequestId}
                  wordWrap={wordWrap}
                  onPostRender={onFilePostRender("virtualizer")}
                  onPendingChange={onPendingChange}
                  onEditorChange={handleEditorChangeStable}
                />
              </DiffWorkerPoolProvider>
            )
          ) : null}
        </div>
        {showExplorer ? (
          <FileExplorerPane resizable={Boolean(previewPath)}>
            <div
              className="contents"
              onClick={focusEditorOnTreeRowClickOrEnter}
              onKeyDown={(event) => {
                if (event.key === "Enter") focusEditorOnTreeRowClickOrEnter(event);
              }}
            >
              <FileBrowserPanel
                key={`${environmentId}:${hostFolderPath ?? cwd}`}
                environmentId={environmentId}
                cwd={hostFolderPath ?? cwd}
                projectName={hostFolderPath ?? projectName}
                hostFolder={hostFolderPath !== null}
                selectedPath={
                  hostFolderPath === null
                    ? relativePath
                    : trailChildOf(hostFolderPath, breadcrumbTrail ?? hostFolderPath)
                }
                selectedPathRevealId={revealRequestId}
                onOpenFile={onOpenFile}
                answersPanelFind={!previewPath}
                workspaceMutationId={workspaceMutationId}
                {...(previewPath && !isMedia && !isPdf
                  ? {
                      onRefreshSelectedFile: () => {
                        if (!isDocument) file.refresh();
                        setFileRefreshRevision((value) => value + 1);
                      },
                    }
                  : {})}
              />
            </div>
          </FileExplorerPane>
        ) : null}
      </div>
    </div>
  );
}

// A draft has no thread yet, so its download is scoped to the draft's workspace instead.
function largeFileResource(
  threadRef: ScopedThreadRef,
  absolutePath: string,
  draftCwd: string | null,
): AssetResource {
  return draftCwd === null
    ? {
        _tag: "media-file",
        threadId: threadRef.threadId,
        path: absolutePath,
        disposition: "attachment",
      }
    : {
        _tag: "draft-workspace-file",
        cwd: draftCwd,
        path: absolutePath,
        disposition: "attachment",
      };
}

/** Copy and save for a file past the 1 MB preview, which the panel holds only in its viewer. */
function LargeFileActions(props: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef;
  absolutePath: string;
  draftCwd: string | null;
  name: string;
  copyContents: RefObject<(() => Promise<string>) | null>;
}) {
  const gt = useGT();
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: namedClipboardTarget(props.name),
  });
  const [saving, setSaving] = useState(false);
  const refreshAssetUrl = useAssetUrlRefresh(
    props.environmentId,
    largeFileResource(props.threadRef, props.absolutePath, props.draftCwd),
  );
  const showError = (cause: unknown) => {
    toastManager.add({
      type: "error",
      title: gt("Could not read file"),
      description: thrownErrorMessage(cause, m) ?? gt("Try again."),
    });
  };
  return (
    <>
      <FileSurfaceAction
        label={isCopied ? gt("Copied") : gt("Copy contents")}
        onPress={() => {
          const copy = props.copyContents.current;
          if (!copy) return;
          void copy()
            .then((text) => copyToClipboard(text, undefined))
            .catch(showError);
        }}
      >
        {isCopied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </FileSurfaceAction>
      <FileSurfaceAction
        label={saving ? gt("Preparing file…") : gt("Save file")}
        disabled={saving}
        onPress={() => {
          setSaving(true);
          void (async () => {
            const url = await refreshAssetUrl();
            if (!url) throw new Error(gt("Reconnect to the environment and try again."));
            const response = await fetch(url);
            if (!response.ok) throw new Error(gt("The file could not be loaded. Try again."));
            const downloadUrl = URL.createObjectURL(await response.blob());
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 30_000);
            const anchor = document.createElement("a");
            anchor.href = downloadUrl;
            anchor.download = props.name.split(/[\\/]/).at(-1) || props.name;
            anchor.click();
          })()
            .catch(showError)
            .finally(() => setSaving(false));
        }}
      >
        <DownloadIcon className="size-3.5" />
      </FileSurfaceAction>
    </>
  );
}

export function WorkspaceLargeTextPreview(props: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef;
  absolutePath: string;
  /** The draft's workspace while the thread does not exist yet. */
  draftCwd: string | null;
  name: string;
  delimiter: "," | "\t" | null;
  /** Renders the file as Markdown resolving links against this workspace; null shows source. */
  markdownCwd: string | null;
  copyContents: RefObject<(() => Promise<string>) | null>;
  /** The first megabyte already read, shown until the whole file arrives. */
  preview: string;
  sizeBytes: number;
  onPostRender?: ComponentProps<typeof LargeFilePreview>["onPostRender"];
  workspaceMutationId: string | null;
  revealLine: number | null;
  revealRequestId: number;
  wordWrap: boolean;
}) {
  const resource = {
    _tag: "media-file",
    threadId: props.threadRef.threadId,
    path: props.absolutePath,
    disposition: "attachment",
  } as const;
  const copyContents = useRef<(() => Promise<string>) | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: props.name });
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const showError = (cause: unknown) => {
    toastManager.add({
      type: "error",
      title: m(msg("Could not read file")),
      description: cause instanceof Error ? cause.message : m(msg("Try again.")),
    });
  };
  // Each workspace mutation re-mints the URL, so an edited file loads its new bytes.
  const assetUrl = useAssetUrlState(
    props.environmentId,
    resource,
    props.workspaceMutationId ?? undefined,
  );
  const refreshAssetUrl = useAssetUrlRefresh(props.environmentId, resource);
  const contentRevision = JSON.stringify([
    props.environmentId,
    resource,
    assetUrl._tag === "Success" ? (assetUrl.fileRevision ?? props.workspaceMutationId) : null,
    revision,
  ]);
  const [loaded, setLoaded] = useState<{ revision: string; url: string } | null>(null);
  if (assetUrl._tag === "Success" && loaded?.revision !== contentRevision) {
    setLoaded({ revision: contentRevision, url: assetUrl.url });
  }
  if (assetUrl._tag === "Failure")
    return (
      <FileSurfaceFailure
        message={msg("Unable to load file preview.")}
        onRetry={() => {
          setRevision((value) => value + 1);
          void refreshAssetUrl().catch(showError);
        }}
      />
    );
  if (assetUrl._tag !== "Success" || loaded === null) return <FileSurfaceLoading />;
  const src = `${loaded.url}${loaded.url.includes("?") ? "&" : "?"}revision=${encodeURIComponent(loaded.revision)}`;
  return (
    <>
      <div className={FILE_SURFACE_SUBHEADER_CLASS}>
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">
          <T>Full file</T>
        </span>
        <FileSurfaceAction
          label={isCopied ? m(msg("Copied")) : m(msg("Copy contents"))}
          onPress={() => {
            const copy = copyContents.current;
            if (!copy) return;
            void copy()
              .then((text) => copyToClipboard(text, undefined))
              .catch(showError);
          }}
        >
          {isCopied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </FileSurfaceAction>
        <FileSurfaceAction
          label={saving ? m(msg("Preparing file…")) : m(msg("Save file"))}
          disabled={saving}
          onPress={() => {
            setSaving(true);
            void (async () => {
              const url = await refreshAssetUrl();
              if (!url) throw new Error("Reconnect to the environment and try again.");
              const response = await fetch(url);
              if (!response.ok) throw new Error("The file could not be loaded. Try again.");
              const downloadUrl = URL.createObjectURL(await response.blob());
              setTimeout(() => URL.revokeObjectURL(downloadUrl), 30_000);
              const anchor = document.createElement("a");
              anchor.href = downloadUrl;
              anchor.download = props.name.split(/[\\/]/).at(-1) || props.name;
              anchor.click();
            })()
              .catch(showError)
              .finally(() => setSaving(false));
          }}
        >
          <DownloadIcon className="size-3.5" />
        </FileSurfaceAction>
      </div>
      <Suspense
        fallback={
          <div className="p-6 text-xs text-muted-foreground">
            <T>Loading…</T>
          </div>
        }
      >
        <LargeTextViewer
          key={`${src}:${revision}`}
          name={props.name}
          copyContents={copyContents}
          onRetry={() => {
            void refreshAssetUrl()
              .then(() => setRevision((value) => value + 1))
              .catch(showError);
          }}
          src={src}
          delimiter={props.delimiter}
          revealLine={props.revealLine}
          revealRequestId={props.revealRequestId}
          wordWrap={props.wordWrap}
        />
      </Suspense>
    </>
  );
}
