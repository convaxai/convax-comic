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

export function PanelRightIcon({ size = 16, ...props }: IconProps): ReactElement {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 16 16"
      width={size}
      {...props}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        transform="translate(16 0) scale(-1 1)"
        d="M9.67272.522841c1.16118 0 2.08723-.000127 2.82358.079652.74897.081164 1.38261.251755 1.93005.649477.32403.23542.60912.5205.84454.84453.39772.54744.56831 1.18108.64948 1.93005C16.0002 4.7629 16 5.68895 16 6.85014v2.29972c0 1.16124.0002 2.08724-.07963 2.82364-.08117.7489-.25176 1.3826-.64948 1.93-.23542.324-.52051.6091-.84454.8445-.54744.3978-1.18108.5683-1.93005.6495-.73635.0798-1.6624.0797-2.82358.0797H6.3273c-1.16119 0-2.08724.0001-2.82359-.0797-.74897-.0812-1.38261-.2517-1.93005-.6495-.32403-.2354-.609111-.5205-.844529-.8445-.397724-.5474-.568314-1.1811-.649478-1.93C-.000126 11.2371 0 10.3111 0 9.14986V6.85014C0 5.68895-.000126 4.7629.079653 4.02655c.081164-.74897.251754-1.38261.649478-1.93005.235418-.32403.520499-.60911.844529-.84453.54744-.397722 1.18108-.568313 1.93005-.649477C4.24006.522714 5.16611.522841 6.3273.522841h3.34542ZM5.54303 1.88715V14.1118c.24333.001.50406.0051.78427.0051h3.34542c1.19118 0 2.03048-.0005 2.67658-.0704.6331-.0686 1.0004-.1971 1.2775-.3983.2086-.1516.3927-.3357.5443-.5443.2012-.2771.3296-.6444.3982-1.2775.07-.6461.0705-1.4854.0705-2.67654V6.85014c0-1.19118-.0005-2.03047-.0705-2.67654-.0686-.63312-.197-1.00042-.3982-1.27751-.1516-.20862-.3357-.39272-.5443-.5443-.2771-.20119-.6444-.32967-1.2775-.39826-.6461-.06995-1.4854-.07046-2.67658-.07046H6.3273c-.28021 0-.54094.00313-.78427.00408Zm-1.36023.02451c-.19155.00994-.368.02411-.53204.04187-.63312.06859-1.00042.19707-1.27751.39826-.20862.15158-.39273.33568-.5443.5443-.20119.27709-.32967.64439-.39826 1.27751-.06995.64607-.07046 1.48536-.07046 2.67654v2.29972c0 1.19114.00051 2.03044.07046 2.67654.06859.6331.19707 1.0004.39826 1.2775.15157.2086.33568.3927.5443.5443.27709.2012.64439.3297 1.27751.3983.16402.0177.34051.0309.53204.0408Z"
      />
    </svg>
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
