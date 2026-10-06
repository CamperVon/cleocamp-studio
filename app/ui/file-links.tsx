/** The kept files linked to a record (the Files page), as links that open them. Nothing when there are none. */
export function FileLinks({ files, className = '' }: { files?: Array<{ id: string; title: string }>; className?: string }) {
  if (!files?.length) return null
  return (
    <p className={`text-xs text-muted ${className}`}>
      Files:{' '}
      {files.map((f, i) => (
        <span key={f.id}>
          {i ? ', ' : ''}
          <a href={`/files/${f.id}`} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">{f.title}</a>
        </span>
      ))}
    </p>
  )
}
