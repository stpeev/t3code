import type { VcsCommit } from "@t3tools/contracts";

import { useClientSettings } from "~/hooks/useSettings";
import { formatChatTimestampTooltip } from "~/timestampFormat";

function formatPerson(name: string, email: string | undefined) {
  return email ? `${name} <${email}>` : name;
}

/** Tooltip body for a commit row: the full message, then who made it, when, and where it sits. */
export function CommitDetails({
  commit,
  unpushed,
}: {
  readonly commit: VcsCommit;
  readonly unpushed: boolean;
}) {
  const { timestampFormat } = useClientSettings();
  const author = formatPerson(commit.authorName, commit.authorEmail);
  const committer =
    commit.committerName === undefined
      ? null
      : formatPerson(commit.committerName, commit.committerEmail);
  const showCommitter =
    committer !== null && (committer !== author || commit.committedAt !== commit.authoredAt);

  return (
    <div className="flex flex-col gap-1.5 py-0.5 text-left">
      <div className="font-medium">{commit.subject || commit.shortSha}</div>
      {commit.body ? <div className="whitespace-pre-wrap text-pretty">{commit.body}</div> : null}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 border-t pt-1.5 text-muted-foreground">
        <dt>Author</dt>
        <dd className="text-foreground">{author}</dd>
        <dt>Date</dt>
        <dd>{formatChatTimestampTooltip(commit.authoredAt, timestampFormat)}</dd>
        {showCommitter ? (
          <>
            <dt>Committer</dt>
            <dd>
              {committer}
              {commit.committedAt
                ? `, ${formatChatTimestampTooltip(commit.committedAt, timestampFormat)}`
                : null}
            </dd>
          </>
        ) : null}
        <dt>Commit</dt>
        <dd className="font-mono text-2xs">{commit.sha}</dd>
        {commit.parentShas.length > 0 ? (
          <>
            <dt>{commit.parentShas.length > 1 ? "Merge of" : "Parent"}</dt>
            <dd className="font-mono text-2xs">
              {commit.parentShas.map((sha) => sha.slice(0, commit.shortSha.length)).join(" ")}
            </dd>
          </>
        ) : null}
        {unpushed ? (
          <>
            <dt>Remote</dt>
            <dd>Not pushed</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
