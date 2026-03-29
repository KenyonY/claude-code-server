import { AlertCircle, CheckCircle2, AlertTriangle, X } from 'lucide-react'
import { useToastStore } from '../store/toast'

const icons = {
  error: AlertCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
}

const styles = {
  error: 'bg-destructive/10 border-destructive/30 text-destructive',
  warning: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-600 dark:text-yellow-400',
  success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
}

export default function ToastContainer() {
  const { toasts, removeToast } = useToastStore()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => {
        const Icon = icons[toast.type]
        return (
          <div
            key={toast.id}
            className={`flex items-start gap-2 px-3 py-2.5 border rounded-lg shadow-lg text-sm animate-in slide-in-from-right ${styles[toast.type]}`}
          >
            <Icon className="size-4 shrink-0 mt-0.5" />
            <span className="flex-1">{toast.message}</span>
            <button onClick={() => removeToast(toast.id)} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity">
              <X className="size-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
