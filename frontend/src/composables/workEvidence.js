import { createResource } from "frappe-ui"

// Whitelisted methods backing every Work Evidence surface in the PWA (Task
// detail in views/tasks/TaskList.vue, real-time Timesheet in
// components/CheckInPanel.vue, backdated Timesheet in
// views/attendance/AttendanceRequestForm.vue) - all funnel through the same
// voltamp_fca.voltamp_fca.doctype.work_evidence.work_evidence module the
// Desk form itself uses (voltamp_fca/public/js/work_evidence.js), except
// upload - see uploadWorkEvidence below for why that one's different.
export const WORK_EVIDENCE_METHODS = {
	getEvidence: "voltamp_fca.voltamp_fca.doctype.work_evidence.work_evidence.get_evidence",
	getEvidenceCounts: "voltamp_fca.voltamp_fca.doctype.work_evidence.work_evidence.get_evidence_counts",
	uploadEvidence: "voltamp_fca.voltamp_fca.doctype.work_evidence.work_evidence.upload_evidence",
	deleteEvidence: "frappe.client.delete",
	transcribeVoiceNote: "voltamp_fca.voltamp_fca.voice_transcription.transcribe_for_app",
}

// Metadata only, one page at a time - never the whole evidence history in
// one call. Mirrors PAGE_LENGTH in the Desk's own work_evidence.js.
export const EVIDENCE_PAGE_LENGTH = 10

// Zone.js (loaded for Ionic) patches the global FileReader; the patched
// instance's onload can fire outside of Vue's reactivity in a way that loses
// the callback here. Same workaround already used by the existing
// FileAttachment upload helper below in this file's sibling, composables/index.js.
function getFileReader() {
	const fileReader = new FileReader()
	const zoneOriginalInstance = fileReader["__zone_symbol__originalInstance"]
	return zoneOriginalInstance || fileReader
}

function readAsBase64(blob) {
	return new Promise((resolve, reject) => {
		const reader = getFileReader()
		reader.onload = () => resolve(reader.result.toString().split(",")[1])
		reader.onerror = () => reject(reader.error)
		reader.readAsDataURL(blob)
	})
}

// Uploads one Photo/Voice Note and records it as a Work Evidence row in a
// single round trip (see the server-side upload_evidence). Deliberately not
// the Desk's own raw /api/method/upload_file + frappe.client.insert pair:
// that endpoint's mimetype allow-list (frappe.handler.ALLOWED_MIMETYPES) has
// no audio/* entries and only applies to users without Desk access - exactly
// the PWA's own users - which would silently block every Voice Note upload.
export async function uploadWorkEvidence({ referenceDoctype, referenceName, evidenceType, blob, filename }) {
	const content = await readAsBase64(blob)
	const uploader = createResource({ url: WORK_EVIDENCE_METHODS.uploadEvidence })
	return uploader.submit({
		reference_doctype: referenceDoctype,
		reference_name: referenceName,
		evidence_type: evidenceType,
		content,
		filename,
		content_type: blob.type || "",
	})
}
