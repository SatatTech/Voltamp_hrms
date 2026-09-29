<template>
	<div class="flex flex-col gap-3 w-full">
		<!-- Always rendered right where the caller places it (directly below the
			Task/Timesheet description) - even before a real Task/Timesheet exists
			to attach to yet (e.g. CheckInPanel.vue before the first Check In).
			Only disabled/hidden pieces change based on hasReference/canWrite, so
			the layout position never shifts once a record shows up. -->
		<div v-if="canWrite" class="flex flex-row gap-2 w-full">
			<Button
				variant="outline"
				iconLeft="mic"
				class="flex-1 py-5 text-sm rounded"
				:disabled="isUploading || !canAttach"
				@click="openRecorder"
			>
				{{ __("Voice Note") }}
			</Button>

			<Button
				variant="outline"
				iconLeft="camera"
				class="flex-1 py-5 text-sm rounded"
				:disabled="isUploading || !canAttach"
				@click="triggerPhotoPicker"
			>
				{{ __("Upload Photo") }}
			</Button>

			<input
				ref="photoInput"
				type="file"
				accept="image/*"
				capture="environment"
				multiple
				class="hidden"
				@change="onPhotosSelected"
			/>
		</div>

		<p v-if="canWrite && !canAttach && emptyReferenceHint" class="text-xs text-gray-400">
			{{ emptyReferenceHint }}
		</p>

		<!-- Non-blocking upload/recording status - the rest of the Task/Timesheet
			screen stays fully usable while this is showing. -->
		<div
			v-if="uploadStatus"
			class="flex flex-row items-center gap-2 text-xs"
			:class="uploadStatus.error ? 'text-red-600' : 'text-gray-500'"
		>
			<LoadingIndicator v-if="!uploadStatus.done" class="h-3 w-3" />
			<FeatherIcon v-else-if="uploadStatus.error" name="x-circle" class="h-3 w-3" />
			<FeatherIcon v-else name="check-circle" class="h-3 w-3" />
			<span>{{ uploadStatus.message }}</span>
		</div>

		<div v-if="hasReference" class="flex flex-col gap-2 rounded-md border border-gray-200 p-3">
			<span class="text-sm font-medium text-gray-800">{{ __("Work Evidence") }}</span>
			<div class="flex flex-row items-center gap-4 text-xs text-gray-500">
				<span>{{ __("Photos") }}: {{ counts.loading ? "…" : photoCount }}</span>
				<span>{{ __("Voice Notes") }}: {{ counts.loading ? "…" : voiceNoteCount }}</span>
			</div>
			<Button variant="outline" class="w-full py-4" @click="isViewerOpen = true">
				{{ __("View Evidence") }}
			</Button>
		</div>

		<VoiceNoteRecorder :isOpen="isRecorderOpen" @did-dismiss="isRecorderOpen = false" @save="handleVoiceNoteSave" />

		<WorkEvidenceViewer
			v-if="hasReference"
			:isOpen="isViewerOpen"
			:referenceDoctype="referenceDoctype"
			:referenceName="referenceName"
			:canWrite="canWrite"
			@did-dismiss="isViewerOpen = false"
			@changed="reloadCounts"
		/>
	</div>
</template>

<script setup>
import { ref, computed, watch, inject } from "vue"
import { FeatherIcon, LoadingIndicator, createResource, toast } from "frappe-ui"

import VoiceNoteRecorder from "@/components/work-evidence/VoiceNoteRecorder.vue"
import WorkEvidenceViewer from "@/components/work-evidence/WorkEvidenceViewer.vue"
import { WORK_EVIDENCE_METHODS, uploadWorkEvidence } from "@/composables/workEvidence"

const __ = inject("$translate")

const props = defineProps({
	// "Task" or "Timesheet" - the Work Evidence doctype's own reference_doctype.
	referenceDoctype: {
		type: String,
		required: true,
	},
	// May be empty/falsy when the underlying record doesn't exist yet (e.g.
	// CheckInPanel.vue before the first Check In of the day creates a draft
	// Timesheet) - the buttons still render in place, just disabled, rather
	// than the whole section popping in/out of the layout later.
	referenceName: {
		type: String,
		default: "",
	},
	// Optional hint shown under the buttons while referenceName is empty,
	// explaining why they're disabled (e.g. "Check in to start adding
	// Work Evidence").
	emptyReferenceHint: {
		type: String,
		default: "",
	},
	// Whether the current user may upload/delete evidence here - the same
	// write permission on the Task/Timesheet itself (see
	// voltamp_fca.voltamp_fca.permission.work_evidence.work_evidence_has_permission,
	// which defers to exactly that). Callers fetch this once (e.g. via
	// frappe.client.get_doc_permissions) and pass it down, rather than this
	// component re-deriving it - it has no doctype-specific way to know.
	canWrite: {
		type: Boolean,
		default: false,
	},
	// Optional async function returning a referenceName, called on the first
	// upload while referenceName is still empty - lets a caller create the
	// record only once there's actually evidence to attach (e.g.
	// CheckInPanel.vue's day Timesheet), instead of up front. The caller is
	// expected to then pass the created name back in as referenceName.
	ensureReference: {
		type: Function,
		default: null,
	},
})

const photoInput = ref(null)
const isRecorderOpen = ref(false)
const isViewerOpen = ref(false)
const uploadStatus = ref(null)
const inFlightUploads = ref(0)
const isUploading = computed(() => inFlightUploads.value > 0)
const hasReference = computed(() => Boolean(props.referenceName))
const canAttach = computed(() => hasReference.value || Boolean(props.ensureReference))

// Cheap, attachment-free counts for the compact summary - never the
// paginated evidence list itself (see get_evidence_counts on the server).
const counts = createResource({ url: WORK_EVIDENCE_METHODS.getEvidenceCounts })
const photoCount = computed(() => counts.data?.Photo || 0)
const voiceNoteCount = computed(() => counts.data?.["Voice Note"] || 0)

function reloadCounts() {
	if (!hasReference.value) return
	counts.submit({ reference_doctype: props.referenceDoctype, reference_name: props.referenceName })
}

// Re-fetch whenever the underlying record changes - callers like
// TaskList.vue's detail sheet reuse a single WorkEvidenceSection instance
// across whichever Task the user has open, rather than remounting it. Also
// covers a record that didn't exist yet on mount (referenceName starts
// empty) suddenly appearing, e.g. Check In creating the draft Timesheet.
watch(() => [props.referenceDoctype, props.referenceName], reloadCounts, { immediate: true })

function openRecorder() {
	if (isUploading.value || !canAttach.value) return
	isRecorderOpen.value = true
}

function triggerPhotoPicker() {
	if (isUploading.value || !canAttach.value) return
	photoInput.value?.click()
}

function onPhotosSelected(event) {
	const files = Array.from(event.target.files || [])
	// Clear the input immediately - besides allowing the same file to be
	// re-picked later, this stops a lingering selection from being
	// resubmitted by anything else that might touch this input.
	event.target.value = ""
	files.forEach((file) => upload(file, "Photo", file.name))
}

function handleVoiceNoteSave({ blob, filename }) {
	isRecorderOpen.value = false
	upload(blob, "Voice Note", filename)
}

async function upload(blob, evidenceType, filename) {
	inFlightUploads.value += 1
	uploadStatus.value = { message: __("Uploading {0}…", [filename]), done: false, error: false }

	try {
		const referenceName = props.referenceName || (await props.ensureReference())
		await uploadWorkEvidence({
			referenceDoctype: props.referenceDoctype,
			referenceName,
			evidenceType,
			blob,
			filename,
		})
		uploadStatus.value = { message: __("{0} added", [__(evidenceType)]), done: true, error: false }
		reloadCounts()
	} catch (error) {
		uploadStatus.value = {
			message: error?.messages?.[0] || __("Could not upload {0}. Please try again.", [filename]),
			done: true,
			error: true,
		}
		toast({
			title: __("Error"),
			text: __("Upload failed"),
			icon: "alert-circle",
			position: "bottom-center",
			iconClasses: "text-red-500",
		})
	} finally {
		inFlightUploads.value -= 1
		const statusAtFinish = uploadStatus.value
		setTimeout(() => {
			if (uploadStatus.value === statusAtFinish) uploadStatus.value = null
		}, 2500)
	}
}
</script>
