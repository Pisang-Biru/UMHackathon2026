import { useRouter } from '@tanstack/react-router'
import {
  Dialog,
  DialogContent,
} from '#/components/ui/dialog'
import { CreateBusinessForm } from '#/components/create-business-form'
import { createBusiness } from '#/lib/business-server-fns'

interface CreateBusinessDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateBusinessDialog({ open, onOpenChange }: CreateBusinessDialogProps) {
  const router = useRouter()

  async function handleSubmit(data: { name: string; mission?: string }) {
    const business = await createBusiness({ data })
    onOpenChange(false)
    await router.navigate({
      to: '/$businessCode/dashboard',
      params: { businessCode: business.code },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="p-8 border"
        style={{ background: '#0c0c0f', borderColor: '#2e2e35', maxWidth: '480px' }}
      >
        <CreateBusinessForm
          onSubmit={handleSubmit}
          onCancel={() => onOpenChange(false)}
          showCancel
        />
      </DialogContent>
    </Dialog>
  )
}
