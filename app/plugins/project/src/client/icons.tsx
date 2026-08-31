import type { ReactElement, SVGProps } from 'react'
import type { ProjectFileEntry } from '../contracts.js'

type IconProps = SVGProps<SVGSVGElement> & { readonly size?: number }

function SvgIcon({ size = 16, children, ...props }: IconProps): ReactElement {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {children}
    </svg>
  )
}

export function ChevronRightIcon(props: IconProps): ReactElement {
  return <SvgIcon {...props}><path d="m9 18 6-6-6-6" /></SvgIcon>
}

export function PlusIcon(props: IconProps): ReactElement {
  return <SvgIcon {...props}><path d="M12 5v14M5 12h14" /></SvgIcon>
}

export function PanelRightIcon({ open, ...props }: IconProps & { readonly open: boolean }): ReactElement {
  return (
    <SvgIcon {...props}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
      <path d={open ? 'm10 9-3 3 3 3' : 'm8 9 3 3-3 3'} />
    </SvgIcon>
  )
}

function FolderIcon({ open, ...props }: IconProps & { readonly open: boolean }): ReactElement {
  if (open) {
    return (
      <SvgIcon {...props}>
        <path d="M2 6a2 2 0 0 1 2-2h4l2 3h10a2 2 0 0 1 2 2" />
        <path d="m3 10 1.7 8.1A2 2 0 0 0 6.7 20h10.7a2 2 0 0 0 1.9-1.4L22 10Z" />
      </SvgIcon>
    )
  }
  return (
    <SvgIcon {...props}>
      <path d="M20 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z" />
    </SvgIcon>
  )
}

function FileTextIcon(props: IconProps): ReactElement {
  return (
    <SvgIcon {...props}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" />
      <path d="M14 2v6h6M8 13h8M8 17h6" />
    </SvgIcon>
  )
}

function FileImageIcon(props: IconProps): ReactElement {
  return (
    <SvgIcon {...props}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" />
      <path d="M14 2v6h6M10 13l-2 3h8l-3-4-2 3M9 11h.01" />
    </SvgIcon>
  )
}

function FileAudioIcon(props: IconProps): ReactElement {
  return (
    <SvgIcon {...props}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" />
      <path d="M14 2v6h6M11 18v-5l4-1v5M9.5 18a1.5 1.5 0 1 0 1.5-1.5M13.5 17a1.5 1.5 0 1 0 1.5-1.5" />
    </SvgIcon>
  )
}

function FileVideoIcon(props: IconProps): ReactElement {
  return (
    <SvgIcon {...props}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" />
      <path d="M14 2v6h6M9 13l5 3-5 3Z" />
    </SvgIcon>
  )
}

function FileCodeIcon(props: IconProps): ReactElement {
  return (
    <SvgIcon {...props}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" />
      <path d="M14 2v6h6M10 13l-2 2 2 2M14 13l2 2-2 2" />
    </SvgIcon>
  )
}

function ExternalLinkIcon(props: IconProps): ReactElement {
  return (
    <SvgIcon {...props}>
      <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </SvgIcon>
  )
}

const imageExtensions = new Set(['avif', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'])
const videoExtensions = new Set(['m4v', 'mov', 'mp4', 'webm'])
const audioExtensions = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav'])
const codeExtensions = new Set(['c', 'cpp', 'css', 'go', 'html', 'js', 'jsx', 'json', 'py', 'rs', 'sh', 'ts', 'tsx', 'vue', 'yaml', 'yml'])

export function ProjectEntryIcon({ entry, expanded }: { readonly entry: ProjectFileEntry; readonly expanded: boolean }): ReactElement {
  if (entry.kind === 'directory') return <FolderIcon className="cvxProjectIconFolder" open={expanded} />
  if (entry.kind === 'symlink') return <ExternalLinkIcon className="cvxProjectIconMuted" />
  const extension = entry.name.split('.').pop()?.toLowerCase() ?? ''
  if (imageExtensions.has(extension)) return <FileImageIcon className="cvxProjectIconImage" />
  if (videoExtensions.has(extension)) return <FileVideoIcon className="cvxProjectIconVideo" />
  if (audioExtensions.has(extension)) return <FileAudioIcon className="cvxProjectIconAudio" />
  if (codeExtensions.has(extension)) return <FileCodeIcon className="cvxProjectIconCode" />
  return <FileTextIcon className="cvxProjectIconMuted" />
}
