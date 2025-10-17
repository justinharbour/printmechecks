<template>
    <div class="about">
        <h1>History</h1>
        <div v-if="history.length === 0">
            <p>No history yet</p>
        </div>
        <div v-else>
            <table class="table">
                <thead>
                    <tr>
                        <th>Check #</th>
                        <th>Amount</th>
                        <th>Payee</th>
                        <th>Account</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(item, index) in history" :key="item.id">
                        <td>{{ item.checkNumber }}</td>
                        <td>${{ formatMoney(item.amount) }}</td>
                        <td>{{ item.payTo }}</td>
                        <td>{{ item.bankAccountNumber }}</td>
                        <td>
                            <button class="btn btn-outline-danger" @click="deleteItem(index)" style="margin-right: 10px">Delete</button>
                            <button class="btn btn-outline-primary" @click="viewItem(index)">View</button>
                        </td>

                    </tr>
                </tbody>
            </table>
        </div>

        <!-- PostGrid send-job tracking -->
        <div style="margin-top: 2rem">
          <h2>PostGrid Sends</h2>
          <div v-if="loadingSends">Loading...</div>
          <div v-else>
            <div v-if="sendJobs.length === 0">
              <p>No PostGrid sends yet.</p>
            </div>
            <div v-else>
              <table class="table">
                <thead>
                  <tr>
                    <th>Job ID</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Recipient</th>
                    <th>Provider ID</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="job in sendJobs" :key="job.id">
                    <td>{{ job.id }}</td>
                    <td>{{ job.method }}</td>
                    <td>{{ job.status }}</td>
                    <td>{{ job.recipient?.name || (job.recipient?.address?.line1 || '') }}</td>
                    <td>{{ job.providerId || '-' }}</td>
                    <td>
                      <button class="btn" @click="doRefresh(job)" style="margin-right:8px">Refresh</button>
                      <button class="btn" @click="doSimulate(job)">Simulate Webhook</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

    </div>
</template>

<style>
</style>

<script setup>
import {formatMoney} from '../utilities.ts'
import { ref, onMounted} from 'vue'
import { useAppStore } from '../stores/app.ts'
import { useRouter } from 'vue-router'
import { listSendJobs, refreshJob, simulateWebhook } from '../services/sendApi'

const state = useAppStore()
const router = useRouter()

const history = ref([])
const sendJobs = ref([])
const loadingSends = ref(false)

const loadHistory = () => {
  history.value = JSON.parse(localStorage.getItem('checkList') || '[]')
}

const loadSends = async () => {
  loadingSends.value = true
  try {
    sendJobs.value = await listSendJobs()
  } catch (err) {
    console.error('failed to load send jobs', err)
    sendJobs.value = []
  } finally {
    loadingSends.value = false
  }
}

const deleteItem = (index) => {
  history.value.splice(index, 1)
  localStorage.setItem('checkList', JSON.stringify(history.value))
}

const viewItem = (index) => {
    const item = history.value[index]
    state.check = item
    router.push('/')
}

const doRefresh = async (job) => {
  try {
    const updated = await refreshJob(job.id)
    // update local list
    const idx = sendJobs.value.findIndex(s => s.id === job.id)
    if (idx !== -1) sendJobs.value[idx] = updated
  } catch (err) {
    console.error('refresh failed', err)
    alert('Refresh failed: ' + (err.message || err))
  }
}

const doSimulate = async (job) => {
  try {
    await simulateWebhook(job.providerId || (`sim-${job.id}`))
    // reload list
    await loadSends()
  } catch (err) {
    console.error('simulate failed', err)
    alert('Simulate webhook failed: ' + (err.message || err))
  }
}

onMounted(() => {
  loadHistory()
  loadSends()
})


</script>
