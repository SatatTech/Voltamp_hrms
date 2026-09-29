<template>
	<ion-page>
		<ion-content :fullscreen="true">
			<FormView
				v-if="formFields.data"
				doctype="Attendance Request"
				:title="__('Backdated Timesheet')"
				v-model="attendanceRequest"
				:isSubmittable="true"
				:fields="formFields.data"
				:id="props.id"
				@validateForm="validateForm"
				@formReloaded="skipNextAddressGeocode = true"
			>
				<template #timesheet_details_section-action>
					<Button variant="ghost" icon="filter" @click="isTaskFilterOpen = true" />
				</template>

				<template #location_section-action>
					<Button
						variant="ghost"
						size="sm"
						:loading="isFetchingLocation"
						@click="fetchLiveLocation"
					>
						<template #prefix>
							<img :src="locationIcon" class="h-4 w-4" alt="" />
						</template>
						{{ __("Get Location") }}
					</Button>
				</template>

				<template #location_address-after>
					<LocationMap
						:latitude="attendanceRequest.latitude"
						:longitude="attendanceRequest.longitude"
						:status="locationStatus"
					/>
				</template>

				<template #description-after>
					<WorkEvidenceSection
						referenceDoctype="Timesheet"
						:referenceName="attendanceRequest.timesheet || ''"
						:canWrite="!attendanceRequest.timesheet || canEditTimesheetEvidence"
						:ensureReference="canCreateEvidenceTimesheet ? ensureEvidenceTimesheet : null"
						:emptyReferenceHint="
							canCreateForOthers
								? __('Pick From Date and Employee to start adding Work Evidence')
								: __('Pick a From Date to start adding Work Evidence')
						"
					/>
				</template>
			</FormView>

			<CustomIonModal :isOpen="isTaskFilterOpen" @did-dismiss="isTaskFilterOpen = false">
				<template #actionSheet>
					<div class="bg-white w-full flex flex-col items-center pb-5">
						<div class="w-full pt-8 pb-5 border-b text-center">
							<span class="text-gray-900 font-bold text-lg">{{ __("Filter Tasks") }}</span>
						</div>
						<div class="w-full flex flex-col gap-4 p-4">
							<FormField
								:label="__('From Date')"
								fieldtype="Date"
								v-model="taskDateFilter.from_date"
							/>
							<FormField
								:label="__('To Date')"
								fieldtype="Date"
								v-model="taskDateFilter.to_date"
							/>
							<div class="flex flex-row gap-3">
								<Button variant="outline" class="w-full py-5 text-sm" @click="clearTaskFilter">
									{{ __("Clear") }}
								</Button>
								<Button variant="solid" class="w-full py-5 text-sm" @click="isTaskFilterOpen = false">
									{{ __("Apply") }}
								</Button>
							</div>
						</div>
					</div>
				</template>
			</CustomIonModal>
		</ion-content>
	</ion-page>
</template>

<script setup>
import { IonPage, IonContent } from "@ionic/vue"
import { createResource, debounce } from "frappe-ui"
import { ref, computed, watch, inject } from "vue"

import router from "@/router"
import FormView from "@/components/FormView.vue"
import FormField from "@/components/FormField.vue"
import CustomIonModal from "@/components/CustomIonModal.vue"
import LocationMap from "@/components/LocationMap.vue"
import WorkEvidenceSection from "@/components/work-evidence/WorkEvidenceSection.vue"
import locationIcon from "@/assets/location.avif"

const employee = inject("$employee")
const user = inject("$user")
const __ = inject("$translate")
const dayjs = inject("$dayjs")

// Only the Projects Manager role may create a Backdated Timesheet on behalf
// of another employee - not even System Manager/HR Manager/HR User, unless
// they also hold this role (an Employee-role user may only use real-time
// Check-In/Check-Out). Mirrors the check in AttendanceRequest.validate() in
// hrms/hr/doctype/attendance_request/attendance_request.py - the server
// re-checks this independently, so this is UX only, not the enforcement.
const canCreateForOthers = computed(() => Boolean(user.data?.roles?.includes("Projects Manager")))

// A Backdated Timesheet's From/To Date must not be a future date. Anyone
// other than a Projects Manager is also held to a 36-hour window of From
// Date - a Projects Manager may backdate any number of days, but never for
// their own Employee. This is a client-side mirror of the server-side checks
// (the authoritative enforcement lives in voltamp_fca's Attendance Request
// validate hooks) so the user gets immediate, specific feedback instead of a
// round-trip. Scoped to fresh creation only (!props.id) - editing/
// resubmitting an already-created request isn't affected by these rules.
const BACKDATED_WINDOW_HOURS = 36

const props = defineProps({
	id: {
		type: String,
		required: false,
	},
})

// An Employee-role user must not reach the create form at all - only
// Check-In/Check-Out is available to them. Redirect away as soon as the
// user's roles are known (they're already loaded by the router's global
// beforeEach before this component mounts, so this normally fires immediately).
watch(
	canCreateForOthers,
	(allowed) => {
		if (!props.id && !allowed) router.replace({ name: "Home" })
	},
	{ immediate: true }
)

// reactive object to store form data
const attendanceRequest = ref({})

const isTaskFilterOpen = ref(false)
const taskDateFilter = ref({ from_date: null, to_date: null })
const locationStatus = ref("")

// Before save, the form only has an employee picker for privileged roles
// (canCreateForOthers) - everyone else's request is always their own, so
// fall back to the logged-in employee until the doc actually carries one
// (e.g. a manager's pick, or when viewing/editing an existing request).
const activityTypeEmployee = computed(() => attendanceRequest.value.employee || employee.data.name)

// Task must only list Tasks assigned (via "Assign To") to this employee - not
// every Task in the system - scoped server-side via `task_query`, which also
// applies the date range below (overlap, not containment: a task matches if
// its own start/end span touches the filter window at all — its start is
// on/before the filter's end, and its end is on/after the filter's start).
const taskQuery = "voltamp_fca.voltamp_fca.permission.task.task_query"
const taskLinkFilters = computed(() => {
	const { from_date, to_date } = taskDateFilter.value
	const filters = { employee: activityTypeEmployee.value }
	if (to_date) filters.exp_start_date = ["<=", to_date]
	if (from_date) filters.exp_end_date = [">=", from_date]
	return filters
})

function clearTaskFilter() {
	taskDateFilter.value = { from_date: null, to_date: null }
}

// get form fields
// NOTE: must be declared before the watchers below - they read formFields.data
// (one of them with `immediate: true`, which runs synchronously during setup),
// so declaring this later would reference formFields before initialization.
const formFields = createResource({
	url: "hrms.api.get_doctype_fields",
	params: { doctype: "Attendance Request" },
	auto: true,
	transform(data) {
		if (!props.id) {
			const alwaysExcluded = ["employee_name", "status", "company", "timesheet", "shift"]
			const excluded = canCreateForOthers.value ? alwaysExcluded : [...alwaysExcluded, "employee"]
			data = data.filter((field) => !excluded.includes(field.fieldname))

			// A Projects Manager (or other privileged role) picks who the
			// backdated timesheet is for - show Employee right after To Date.
			if (canCreateForOthers.value) {
				const employeeIndex = data.findIndex((field) => field.fieldname === "employee")
				if (employeeIndex !== -1) {
					const [employeeField] = data.splice(employeeIndex, 1)
					employeeField.query = "hrms.api.employee_query_for_attendance_request"
					const toDateIndex = data.findIndex((field) => field.fieldname === "to_date")
					data.splice(toDateIndex + 1, 0, employeeField)
				}
			}
		}

		for (const field of data) {
			if (["half_day", "include_holidays"].includes(field.fieldname)) {
				field.hidden = 1
			}
			if (field.fieldname === "location_address") {
				// Only fillable via the live-location button, not typed by hand.
				field.read_only = 1
			}
			if (field.fieldname === "description") {
				// Task Description isn't reqd on the doctype itself (voltamp_fca's
				// custom field), but must be mandatory on this form.
				field.reqd = 1
			}
			if (["location_address", "latitude", "longitude"].includes(field.fieldname)) {
				// Keep these visible (as empty, disabled inputs) even in a
				// read-only view of the form, instead of vanishing when unset.
				field.showEmptyWhenReadOnly = true
			}
		}

		// Show Task, Project, Activity Type in that order (matches the Check In
		// panel's Timesheet Details ordering) instead of the doctype's own
		// Activity Type -> Project -> Task field order.
		const timesheetOrder = ["task", "project", "activity_type"]
		const timesheetIndices = timesheetOrder
			.map((name) => data.findIndex((field) => field.fieldname === name))
			.filter((i) => i !== -1)
		if (timesheetIndices.length) {
			const anchor = Math.min(...timesheetIndices)
			const timesheetFields = timesheetOrder
				.map((name) => data.find((field) => field.fieldname === name))
				.filter(Boolean)
			data = data.filter((field) => !timesheetOrder.includes(field.fieldname))
			data.splice(anchor, 0, ...timesheetFields)
		}

		// Move the whole Location section above Reason, per the requested layout.
		const locationStart = data.findIndex((field) => field.fieldname === "location_section")
		if (locationStart !== -1) {
			let locationEnd = data.findIndex(
				(field, i) => i > locationStart && field.fieldtype === "Section Break"
			)
			if (locationEnd === -1) locationEnd = data.length
			const locationFields = data.splice(locationStart, locationEnd - locationStart)

			const reasonIndex = data.findIndex((field) => field.fieldname === "reason_section")
			data.splice(reasonIndex === -1 ? data.length : reasonIndex, 0, ...locationFields)
		}

		return data
	},
})

watch(
	() => [taskLinkFilters.value, formFields.data],
	() => {
		const taskField = formFields.data?.find((field) => field.fieldname === "task")
		if (!taskField) return
		taskField.query = taskQuery
		taskField.linkFilters = taskLinkFilters.value
	},
	{ deep: true }
)

// Activity Type must only list the options in the current employee's
// Employee Skill Map "Work Profile" - scoped via the same whitelisted method
// the desk form uses.
const activityTypeQuery = "voltamp_fca.voltamp_fca.permission.activity_type.activity_type_query"

// If that Work Profile only grants a single Activity Type, there's nothing
// to actually pick from — preselect it instead of making the user open a
// dropdown with one option in it (same behaviour as the Check In panel).
const activityTypeOptions = createResource({ url: activityTypeQuery })

function applyDefaultActivityType() {
	const options = activityTypeOptions.data
	if (options?.length === 1 && !attendanceRequest.value.activity_type) {
		attendanceRequest.value.activity_type = options[0][0]
	}
}

watch(
	() => [activityTypeEmployee.value, formFields.data],
	() => {
		const activityTypeField = formFields.data?.find((field) => field.fieldname === "activity_type")
		if (!activityTypeField) return
		activityTypeField.query = activityTypeQuery
		activityTypeField.linkFilters = { employee: activityTypeEmployee.value }

		if (!activityTypeEmployee.value) return
		activityTypeOptions.submit(
			{
				doctype: "Activity Type",
				txt: "",
				searchfield: "name",
				start: 0,
				page_len: 2,
				filters: { employee: activityTypeEmployee.value },
			},
			{ onSuccess: applyDefaultActivityType }
		)
	},
	{ immediate: true }
)

// Work Evidence (Voice Note/Upload Photo) needs a real Timesheet to attach
// to - rather than making the user Submit this whole Attendance Request
// first just to unlock that, get_or_create_backdated_timesheet_for_evidence
// hands back a draft Timesheet for employee+From Date. It's only called on
// the first upload (see WorkEvidenceSection's ensureReference), not as soon
// as a date is picked - so filling in the form never leaves an empty
// Timesheet behind. create_and_submit_timesheet (the actual Submit's
// on_submit hook) later adopts this exact same draft, so anything attached
// here carries through.
const preSubmitTimesheetAction = createResource({
	url: "voltamp_fca.voltamp_fca.attendance_request_timesheet.get_or_create_backdated_timesheet_for_evidence",
})

const evidenceEmployee = computed(() =>
	// A Projects Manager must pick the Employee first - never fall back to
	// their own, which they may not file for.
	canCreateForOthers.value ? attendanceRequest.value.employee : activityTypeEmployee.value
)
const canCreateEvidenceTimesheet = computed(
	() =>
		!props.id &&
		Boolean(attendanceRequest.value.from_date) &&
		Boolean(evidenceEmployee.value) &&
		!(canCreateForOthers.value && evidenceEmployee.value === employee.data.name)
)

function ensureEvidenceTimesheet() {
	return preSubmitTimesheetAction
		.submit({
			employee: evidenceEmployee.value,
			from_date: dayjs(attendanceRequest.value.from_date).format("YYYY-MM-DD"),
		})
		.then((name) => {
			attendanceRequest.value.timesheet = name
			return name
		})
}

// Evidence belongs to one Employee's day - if either changes on a new form,
// the next upload finds/creates the Timesheet for the new pair instead.
watch(
	() => [evidenceEmployee.value, attendanceRequest.value.from_date && dayjs(attendanceRequest.value.from_date).format("YYYY-MM-DD")],
	(current, previous) => {
		if (props.id || !previous || current.join() === previous.join()) return
		attendanceRequest.value.timesheet = ""
	}
)

// Whether the current user may upload/delete Work Evidence on this Backdated
// Timesheet's linked Timesheet. Real permission on that Timesheet, not just
// "it's linked".
const timesheetEvidencePermissions = createResource({ url: "frappe.client.get_doc_permissions" })
const canEditTimesheetEvidence = computed(() => Boolean(timesheetEvidencePermissions.data?.permissions?.write))

watch(
	() => attendanceRequest.value.timesheet,
	(timesheetName) => {
		if (timesheetName) {
			timesheetEvidencePermissions.submit({ doctype: "Timesheet", docname: timesheetName })
		}
	},
	{ immediate: true }
)

// Auto-fill Project from the selected Task's own project — if the task isn't
// linked to one, just leave Project as-is.
//
// Deliberately not a plain frappe.client.get_value call: Task's role
// permissions don't grant Employee-role users blanket read access (see
// task_query_conditions in voltamp_fca), so that would silently fail for
// any Task without an incidental DocShare. get_task_project mirrors
// task_query's own _assign-based scoping instead, so it works for every
// Task actually assigned to the employee.
const taskProject = createResource({ url: "voltamp_fca.voltamp_fca.permission.task.get_task_project" })

watch(
	() => attendanceRequest.value.task,
	(taskName) => {
		if (!taskName) return

		taskProject.submit(
			{ task: taskName, employee: activityTypeEmployee.value },
			{
				onSuccess(project) {
					if (project) attendanceRequest.value.project = project
				},
			}
		)
	}
)

// form scripts
watch(
	() => attendanceRequest.value.employee,
	(employee_id) => {
		if (props.id && employee_id !== employee.data.name) {
			// if employee is not the current user, set form as read only
			setFormReadOnly()
		}
	}
)

watch(
	() => attendanceRequest.value.from_date,
	(from_date) => {
		if (!attendanceRequest.value.to_date) {
			attendanceRequest.value.to_date = from_date
		}
	}
)

watch(
	() => [attendanceRequest.value.from_date, attendanceRequest.value.to_date],
	([from_date, to_date]) => {
		validateDates(from_date, to_date)
	}
)

watch(
	() => attendanceRequest.value.employee,
	(employee_id) => validateEmployee(employee_id)
)

watch(
	() => attendanceRequest.value.half_day,
	(half_day) => {
		const half_day_date = formFields.data.find((field) => field.fieldname === "half_day_date")
		half_day_date.hidden = !half_day
	}
)

// Location: address -> lat/lng (+ map preview), mirroring the desk form
// (voltamp_fca/public/js/location_geocode.js). `skipNextAddressGeocode`
// avoids re-geocoding on the initial doc load / a formReloaded (only actual
// user edits to the address should trigger a lookup).
let skipNextAddressGeocode = Boolean(props.id)
let geocodeToken = 0

const geocodeAddress = createResource({
	url: "voltamp_fca.voltamp_fca.geolocation.geocode_address",
})

function setLocationError(message) {
	const addressField = formFields.data?.find((field) => field.fieldname === "location_address")
	if (addressField) addressField.error_message = message || ""
}

const fetchLocation = debounce((address) => {
	const token = ++geocodeToken

	if (!address) {
		attendanceRequest.value.latitude = null
		attendanceRequest.value.longitude = null
		locationStatus.value = ""
		setLocationError("")
		return
	}

	locationStatus.value = __("Finding location…")
	setLocationError("")

	geocodeAddress.submit(
		{ address },
		{
			onSuccess(data) {
				if (token !== geocodeToken) return // stale response, address changed again
				attendanceRequest.value.latitude = data.latitude
				attendanceRequest.value.longitude = data.longitude
				locationStatus.value = ""
			},
			onError(error) {
				if (token !== geocodeToken) return
				locationStatus.value = ""
				setLocationError(error.messages?.[0] || __("Could not find that address."))
			},
		}
	)
}, 500)

watch(
	() => attendanceRequest.value.location_address,
	(address) => {
		if (skipNextAddressGeocode) {
			skipNextAddressGeocode = false
			return
		}
		fetchLocation((address || "").trim())
	}
)

// Location: live GPS -> address. The GPS fix itself comes straight from the
// device (position.coords), same as Employee Checkin/Checkout (CheckInPanel.vue).
// The address lookup, however, is done with a direct fetch from the browser
// to Nominatim instead of routing through our backend: it's the *server's*
// outbound call to nominatim.openstreetmap.org that's unreliable on some
// hosting environments (e.g. Frappe Cloud), not the device's — a normal
// browser request to that host works the same as visiting any other site.
const isFetchingLocation = ref(false)

async function reverseGeocodeInBrowser(latitude, longitude) {
	const params = new URLSearchParams({
		lat: latitude,
		lon: longitude,
		format: "json",
	})
	const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
		headers: { Accept: "application/json" },
	})
	if (!response.ok) throw new Error(`HTTP ${response.status}`)

	const data = await response.json()
	if (!data || data.error || !data.display_name) throw new Error("No address found")

	return data.display_name
}

function fetchLiveLocation() {
	if (!navigator.geolocation) {
		setLocationError(__("Geolocation is not supported by your current browser"))
		return
	}

	isFetchingLocation.value = true
	locationStatus.value = __("Locating…")
	setLocationError("")

	navigator.geolocation.getCurrentPosition(
		async (position) => {
			const { latitude, longitude } = position.coords
			geocodeToken++ // invalidate any in-flight address -> coords lookup

			// this is the real GPS reading — don't let it re-trigger a (less
			// precise) address -> coords lookup on top of it
			skipNextAddressGeocode = true
			attendanceRequest.value.latitude = latitude
			attendanceRequest.value.longitude = longitude

			locationStatus.value = __("Finding address…")
			try {
				attendanceRequest.value.location_address = await reverseGeocodeInBrowser(latitude, longitude)
			} catch {
				// address lookup failed - the coordinates are still captured above,
				// so fall back to showing those rather than blocking the user
				attendanceRequest.value.location_address = __("Latitude: {0}°, Longitude: {1}°", [
					latitude.toFixed(5),
					longitude.toFixed(5),
				])
			} finally {
				isFetchingLocation.value = false
				locationStatus.value = ""
			}
		},
		(error) => {
			isFetchingLocation.value = false
			locationStatus.value = ""
			setLocationError(__("Unable to retrieve your location: {0}", [error.message]))
		},
		{ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
	)
}

// helper functions
function setFormReadOnly() {
	formFields.data.map((field) => (field.read_only = true))
}

function validateDates(from_date, to_date) {
	const from_date_field = formFields.data.find((field) => field.fieldname === "from_date")
	if (!from_date_field) return

	let error_message = ""

	// Only enforced on fresh creation - editing/resubmitting an
	// already-created request shouldn't retroactively break just because
	// the 36-hour window has since passed.
	if (!props.id && from_date) {
		const from = dayjs(from_date)
		const endOfToday = dayjs().endOf("day")

		if (from.isAfter(endOfToday) || (to_date && dayjs(to_date).isAfter(endOfToday))) {
			error_message = __("Backdated Timesheet cannot be created for a future date.")
		} else if (!canCreateForOthers.value && dayjs().isAfter(from.add(BACKDATED_WINDOW_HOURS, "hour"))) {
			error_message = __(
				"Backdated Timesheet can only be created within 36 hours of the applicable date/time. The allowed time window has expired."
			)
		}
	}

	if (!error_message && from_date && to_date && from_date > to_date) {
		error_message = __("To Date cannot be before From Date")
	}

	from_date_field.error_message = error_message
}

// A Projects Manager files Backdated Timesheets for others only - never
// their own (the server rejects that too).
function validateEmployee(employee_id) {
	if (props.id || !canCreateForOthers.value) return
	const employeeField = formFields.data?.find((field) => field.fieldname === "employee")
	if (!employeeField) return

	employeeField.error_message =
		employee_id && employee_id === employee.data.name
			? __("You cannot create your own Backdated Timesheet. Please ask your Reports To Manager.")
			: ""
}

function validateForm() {
	// A Projects Manager picks the Employee themselves (and may not pick
	// their own) - only default to "self" for everyone else, where that
	// field isn't even shown.
	if (!attendanceRequest.value.employee && !canCreateForOthers.value) {
		attendanceRequest.value.employee = employee.data.name
	}
	validateEmployee(attendanceRequest.value.employee)

	// Re-run right before submit, not just reactively on field change - the
	// 36-hour window can expire purely from time passing while the form
	// sits open, with no field ever being touched again.
	validateDates(attendanceRequest.value.from_date, attendanceRequest.value.to_date)
}
</script>
