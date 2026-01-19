import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Paperclip, Send, Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * EmailComposeModal - Reusable modal for composing and sending emails with attachments
 *
 * @param {boolean} isOpen - Whether the modal is open
 * @param {function} onClose - Called when modal should close
 * @param {string} defaultTo - Pre-filled recipient email
 * @param {string} defaultSubject - Pre-filled subject
 * @param {string} defaultBody - Pre-filled body text (plain text)
 * @param {string} attachmentName - Name of the file being attached
 * @param {function} onSend - Called with { to, subject, body } when send is clicked
 * @param {boolean} isSending - Whether email is currently being sent
 * @param {string} error - Error message to display
 */
export default function EmailComposeModal({
  isOpen,
  onClose,
  defaultTo = '',
  defaultSubject = '',
  defaultBody = '',
  attachmentName = '',
  onSend,
  isSending = false,
  error = null
}) {
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);

  // Reset form when defaults change
  useEffect(() => {
    setTo(defaultTo);
    setSubject(defaultSubject);
    setBody(defaultBody);
  }, [defaultTo, defaultSubject, defaultBody]);

  const handleSend = () => {
    if (!to || !subject || !body) {
      return;
    }
    onSend({ to, subject, body });
  };

  const handleClose = () => {
    if (!isSending) {
      onClose();
    }
  };

  // Validate email format
  const isValidEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const canSend = to && isValidEmail(to) && subject && body && !isSending;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="w-5 h-5 text-blue-600" />
            Send Email
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="email-to">To</Label>
            <Input
              id="email-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com"
              className={!to || !isValidEmail(to) ? 'border-amber-300' : ''}
            />
            {to && !isValidEmail(to) && (
              <p className="text-xs text-amber-600">Please enter a valid email address</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email-subject">Subject</Label>
            <Input
              id="email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email-body">Message</Label>
            <Textarea
              id="email-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Enter your message..."
              rows={8}
              className="resize-none"
            />
          </div>

          {attachmentName && (
            <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg border">
              <Paperclip className="w-4 h-4 text-slate-500" />
              <span className="text-sm text-slate-700">Attachment: {attachmentName}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={!canSend}
            className="gap-2"
          >
            {isSending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Send Email
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
