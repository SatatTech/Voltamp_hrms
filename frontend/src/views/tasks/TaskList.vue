<template>
	<ion-page>
		<ion-header class="ion-no-border">
			<div class="w-full sm:w-96">
				<div class="flex flex-row bg-white shadow-sm py-4 px-3 items-center border-b">
					<Button variant="ghost" class="!px-1 mr-1 hover:bg-white" @click="router.back()">
						<FeatherIcon name="chevron-left" class="h-5 w-5" />
					</Button>
					<h2 class="text-xl font-semibold text-gray-900">{{ __("Tasks") }}</h2>
				</div>
			</div>
		</ion-header>

		<ion-content>
			<ion-refresher slot="fixed" @ionRefresh="handleRefresh($event)">
				<ion-refresher-content></ion-refresher-content>
			</ion-refresher>

			<div class="flex flex-col items-center mb-7 p-4 h-full w-full sm:w-96 overflow-y-auto">
				<div class="w-full">
					<div
						class="flex flex-col bg-white rounded mt-5"
						v-if="!tasks.loading && tasks.data?.length"
					>
						<div
							class="p-3.5 border-b last:border-b-0 cursor-pointer active:bg-gray-50"
							v-for="task in tasks.data"
							:key="task.name"
							@click="openTaskDetail(task)"
						>
							<TaskItem :doc="task" />
						</div>
					</div>

					<EmptyState :message="__('No tasks found')" v-else-if="!tasks.loading" />

					<div v-if="tasks.loading" class="flex mt-2 items-center justify-center">
						<LoadingIndicator class="w-8 h-8 text-gray-800" />
					</div>
				</div>
			</div>
		</ion-content>

		<CustomIonModal :isOpen="isDetailOpen" @did-dismiss="isDetailOpen = false">
			<template #actionSheet>
				<div class="bg-white w-full flex flex-col max-h-[80vh]" v-if="selectedTask">
					<div class="w-full pt-6 px-4 pb-4 border-b">
						<div class="flex flex-row items-start justify-between gap-3">
							<span class="text-gray-900 font-bold text-lg">{{ selectedTask.subject }}</span>
							<Badge
								variant="outline"
								:theme="statusTheme(selectedTask.status)"
								:label="__(selectedTask.status)"
								size="sm"
							/>
						</div>
					</div>

					<div class="flex flex-col gap-4 p-4 overflow-y-auto">
						<div class="grid grid-cols-2 gap-4">
							<div class="flex flex-col gap-1" v-if="selectedTask.project">
								<span class="text-xs text-gray-500">{{ __("Project") }}</span>
								<span class="text-sm text-gray-800">{{ selectedTask.project }}</span>
							</div>
							<div class="flex flex-col gap-1" v-if="selectedTask.priority">
								<span class="text-xs text-gray-500">{{ __("Priority") }}</span>
								<span class="text-sm text-gray-800">{{ __(selectedTask.priority) }}</span>
							</div>
							<div class="flex flex-col gap-1" v-if="selectedTask.exp_start_date">
								<span class="text-xs text-gray-500">{{ __("Start Date") }}</span>
								<span class="text-sm text-gray-800">
									{{ dayjs(selectedTask.exp_start_date).format("D MMM YYYY, h:mm a") }}
								</span>
							</div>
							<div class="flex flex-col gap-1" v-if="selectedTask.exp_end_date">
								<span class="text-xs text-gray-500">{{ __("End Date") }}</span>
								<span class="text-sm text-gray-800">
									{{ dayjs(selectedTask.exp_end_date).format("D MMM YYYY, h:mm a") }}
								</span>
							</div>
						</div>

						<div class="flex flex-col gap-1.5">
							<span class="text-xs text-gray-500">{{ __("Progress") }}</span>
							<div class="flex flex-row items-center gap-2">
								<div class="grow h-1.5 rounded-full bg-gray-100 overflow-hidden">
									<div
										class="h-full rounded-full bg-gray-800"
										:style="{ width: `${Math.round(selectedTask.progress || 0)}%` }"
									/>
								</div>
								<span class="text-xs text-gray-500 shrink-0">
									{{ Math.round(selectedTask.progress || 0) }}%
								</span>
							</div>
						</div>

						<div class="flex flex-col gap-1.5" v-if="selectedTask.description">
							<span class="text-xs text-gray-500">{{ __("Description") }}</span>
							<div class="text-sm text-gray-800 prose-sm" v-html="selectedTask.description"></div>
						</div>

						<div class="flex flex-col gap-2" v-if="manpower.data?.can_manage">
							<span class="text-xs text-gray-500">{{ __("Required Manpower") }}</span>
							<div class="flex flex-col rounded border border-gray-200">
								<div
									v-for="member in manpower.data.members"
									:key="member.name"
									class="flex flex-row items-center justify-between gap-2 px-3 py-2 border-b last:border-b-0"
								>
									<div class="flex flex-col min-w-0">
										<span class="text-sm text-gray-800 truncate">
											{{ member.employee_name || member.employee }}
										</span>
										<span class="text-xs text-gray-500 truncate">
											{{ member.employee }}{{ member.designation ? ` · ${member.designation}` : "" }}
										</span>
									</div>
									<Button
										variant="ghost"
										icon="trash-2"
										:loading="removingEmployee === member.employee"
										:disabled="isManpowerBusy"
										@click="removeMember(member.employee)"
									/>
								</div>
								<div v-if="!manpower.data.members.length" class="px-3 py-2 text-sm text-gray-500">
									{{ __("No team members yet") }}
								</div>
							</div>
							<div class="flex flex-row items-end gap-2">
								<div class="grow min-w-0">
									<FormField
										fieldtype="Link"
										options="Employee"
										:label="__('Add Team Member')"
										query="voltamp_fca.voltamp_fca.task.employee_query_for_task_manpower"
										:linkFilters="{ task: selectedTask.name }"
										v-model="newMember"
									/>
								</div>
								<Button
									variant="solid"
									class="py-4"
									:loading="addMemberAction.loading"
									:disabled="!newMember || isManpowerBusy"
									@click="addMember"
								>
									{{ __("Add") }}
								</Button>
							</div>
						</div>

						<WorkEvidenceSection
							referenceDoctype="Task"
							:referenceName="selectedTask.name"
							:canWrite="canEditTaskEvidence"
						/>
					</div>
				</div>
			</template>
		</CustomIonModal>
	</ion-page>
</template>

<script setup>
import { IonPage, IonHeader, IonContent, IonRefresher, IonRefresherContent } from "@ionic/vue"
import { Badge, FeatherIcon, LoadingIndicator, createResource, toast } from "frappe-ui"
import { computed, inject, ref } from "vue"
import { useRouter } from "vue-router"

import TaskItem from "@/components/TaskItem.vue"
import FormField from "@/components/FormField.vue"
import CustomIonModal from "@/components/CustomIonModal.vue"
import WorkEvidenceSection from "@/components/work-evidence/WorkEvidenceSection.vue"

const __ = inject("$translate")
const dayjs = inject("$dayjs")
const router = useRouter()

// Scoping (System Manager -> all Tasks, a Project's own Project Manager ->
// only Tasks under Projects they manage, everyone else -> only Tasks
// assigned to them) all lives server-side in get_my_tasks - this page just
// renders whatever it returns.
const tasks = createResource({
	url: "voltamp_fca.voltamp_fca.task.get_my_tasks",
	auto: true,
})

function handleRefresh(event) {
	tasks.reload().finally(() => event.target.complete())
}

const isDetailOpen = ref(false)
const selectedTask = ref(null)

// Whether the current user may upload/delete Work Evidence on the selected
// Task - mirrors the actual write permission (frappe.client.get_doc_permissions),
// not just "the task is visible" (get_my_tasks also returns Tasks a manager
// can only view, not edit).
const taskPermissions = createResource({ url: "frappe.client.get_doc_permissions" })
const canEditTaskEvidence = computed(() => Boolean(taskPermissions.data?.permissions?.write))

// Required Manpower (team members) - only shown to, and editable by, a
// Projects Manager or PM Approver; get_task_manpower returns can_manage
// false for everyone else, who see the Task exactly as before.
const manpower = createResource({ url: "voltamp_fca.voltamp_fca.task.get_task_manpower" })
const addMemberAction = createResource({ url: "voltamp_fca.voltamp_fca.task.add_task_manpower" })
const removeMemberAction = createResource({ url: "voltamp_fca.voltamp_fca.task.remove_task_manpower" })
const newMember = ref("")
const removingEmployee = ref("")
const isManpowerBusy = computed(() => addMemberAction.loading || removeMemberAction.loading)

function openTaskDetail(task) {
	selectedTask.value = task
	isDetailOpen.value = true
	taskPermissions.submit({ doctype: "Task", docname: task.name })
	newMember.value = ""
	manpower.reset()
	manpower.submit({ task: task.name })
}

function showManpowerError(error) {
	toast({
		title: __("Error"),
		text: error?.messages?.[0] || __("Could not update team members."),
		icon: "alert-circle",
		position: "bottom-center",
		iconClasses: "text-red-500",
	})
}

function addMember() {
	addMemberAction.submit(
		{ task: selectedTask.value.name, employee: newMember.value },
		{
			onSuccess(data) {
				manpower.setData(data)
				newMember.value = ""
			},
			onError: showManpowerError,
		}
	)
}

function removeMember(employeeId) {
	removingEmployee.value = employeeId
	removeMemberAction.submit(
		{ task: selectedTask.value.name, employee: employeeId },
		{
			onSuccess: (data) => manpower.setData(data),
			onError: showManpowerError,
		}
	)
		.catch(() => {})
		.finally(() => {
			removingEmployee.value = ""
		})
}

const STATUS_THEME = {
	Open: "gray",
	Working: "blue",
	"Pending Review": "orange",
	Overdue: "red",
	Completed: "green",
	Cancelled: "red",
	Template: "gray",
}

function statusTheme(status) {
	return STATUS_THEME[status] || "gray"
}
</script>
