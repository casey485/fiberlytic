import { useTranslation } from 'react-i18next'
import { Modal } from './ui/Modal'
import { Button } from './ui/Form'

interface Props {
  open: boolean
  onSaveDraft: () => void
  onDiscard: () => void
  onCancel: () => void
}

/** Shown when the Add Work wizard is closed before every required field/photo/billing
 *  line has been filled in — mirrors MarkupDeleteConfirm.tsx's pattern. Every field
 *  already persists live to the store as it's typed, so "Save as Draft" is just closing;
 *  "Discard" hard-deletes the in-progress markup (safe pre-Save, since nothing has been
 *  billed/submitted to production yet). */
export function AddWorkDiscardConfirm({ open, onSaveDraft, onDiscard, onCancel }: Props) {
  const { t } = useTranslation()
  return (
    <Modal
      dark
      open={open}
      onClose={onCancel}
      title={t('addWork.discard.title')}
      footer={
        <div className="flex w-full items-center justify-between">
          <Button dark variant="ghost" onClick={onCancel}>{t('addWork.discard.keepEditing')}</Button>
          <div className="flex items-center gap-2">
            <Button dark variant="danger" onClick={onDiscard}>{t('addWork.discard.discard')}</Button>
            <Button dark variant="primary" onClick={onSaveDraft}>{t('addWork.discard.saveAsDraft')}</Button>
          </div>
        </div>
      }
    >
      <p className="text-sm text-slate-300">{t('addWork.discard.body')}</p>
    </Modal>
  )
}
