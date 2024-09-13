import axios from 'axios';
import { CustomLogger } from '../common/services/logger.service';

const logger = new CustomLogger();
const API_URL = 'http://localhost:3000'

async function testSettings() {
  try {
    // Test creating/updating settings
    logger.log('Creating/Updating settings...');
    const createResponse = await axios.post(`${API_URL}/settings/test-setting`, {
      type: 'test-setting',
      settings: {
        key1: 'value1',
        key2: 'value2'
      }
    });
    logger.log('Create/Update response: ' + JSON.stringify(createResponse.data));

    // Test getting settings
    logger.log('\nGetting settings...');
    const getResponse = await axios.get(`${API_URL}/settings/test-setting`);
    logger.log(`Get response: ${JSON.stringify(getResponse.data)}`);

    // Test updating settings
    logger.log('\nUpdating settings...');
    const updateResponse = await axios.post(`${API_URL}/settings/test-setting`, {
      type: 'test-setting',
      settings: {
        key1: 'new-value1',
        key2: 'new-value2',
        key3: 'value3'
      }
    });
    logger.log(`Update response: ${JSON.stringify(updateResponse.data)}`);

    // Test getting updated settings
    logger.log('\nGetting updated settings...');
    const getUpdatedResponse = await axios.get(`${API_URL}/settings/test-setting`);
    logger.log(`Get updated response: ${JSON.stringify(getUpdatedResponse.data)}`);

    // Test deleting settings
    logger.log('\nDeleting settings...');
    const deleteResponse = await axios.delete(`${API_URL}/settings/test-setting`);
    logger.log(`Delete response: ${JSON.stringify(deleteResponse.data)}`);

    // Test getting deleted settings (should be empty or return a not found error)
    logger.log('\nGetting deleted settings...');
    const getDeletedResponse = await axios.get(`${API_URL}/settings/test-setting`);
    logger.log(`Get deleted response: ${JSON.stringify(getDeletedResponse.data)}`);

  } catch (error) {
    logger.error('An error occurred:', error.stack || 'No stack trace available');
    if (axios.isAxiosError(error)) {
      logger.error('Response status:', String(error.response?.status));
      logger.error('Response data:', JSON.stringify(error.response?.data));
      if (error.response?.data?.details) {
        logger.error('Error details:', JSON.stringify(error.response.data.details));
      }
    } else {
      logger.error('Error message:', error.message);
    }
    logger.error('Full error object:', JSON.stringify(error));
  }
}

testSettings();