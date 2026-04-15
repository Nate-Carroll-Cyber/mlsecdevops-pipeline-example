***

# EU AI Act GPAI Transparency Summary: gpt-oss-safeguards-20B

## 1. General Information
This section outlines the high-level identifying and structural information about the model and its training characteristics.

* [cite_start]**Provider:** OpenAI[cite: 4].
* [cite_start]**Model Identification:** `gpt-oss-20b` (adaptable as `gpt-oss-safeguards-20B`) is an open-weight reasoning model released under the Apache 2.0 license and the gpt-oss usage policy[cite: 18]. [cite_start]It is an autoregressive Mixture-of-Experts (MoE) transformer that builds upon the GPT-2 and GPT-3 architectures[cite: 34]. 
* [cite_start]**Release Date:** August 5, 2025[cite: 5].
* [cite_start]**Model Size & Architecture:** The model consists of 24 layers with 20.9 billion total parameters and 3.6 billion active parameters per token per forward pass[cite: 37, 40]. [cite_start]It utilizes MXFP4 quantization (4.25 bits per parameter) to reduce its memory footprint, allowing it to run on systems with as little as 16GB of memory[cite: 43, 44, 45].
* [cite_start]**Training Data Modalities:** It is a text-only model[cite: 19, 141].
* [cite_start]**Estimated Overall Training Data Size:** The model was trained on a dataset containing "trillions of tokens"[cite: 141].
* **Linguistic & Demographic Characteristics:** The model possesses multilingual capabilities. [cite_start]It was evaluated on a professionally human-translated benchmark across 14 languages: Arabic, Bengali, Chinese, French, German, Hindi, Indonesian, Italian, Japanese, Korean, Portuguese, Spanish, Swahili, and Yoruba[cite: 371, 375].
* [cite_start]**Data Focus & Cutoff:** The training data focuses heavily on STEM, coding, and general knowledge[cite: 141]. [cite_start]The model has a knowledge cutoff of June 2024[cite: 143].

---

## 2. List of Data Sources
This section details the origins of the datasets used across the model's training stages. *(Note: The provided documentation focuses heavily on architecture and safety; as such, specific granular dataset names are not disclosed in the text).*

* [cite_start]**Publicly Available Datasets:** The pre-training stage utilized a text-only dataset of trillions of tokens focused on STEM, coding, and general knowledge[cite: 141]. *The specific names and links to "large" public datasets are not detailed in the provided source text.*
* **Commercially Licensed and Private Datasets:** *The provided text does not explicitly confirm or list the use of commercial or private datasets for the base pre-training phase.*
* [cite_start]**Crawled and Scraped Data:** The model features a browsing tool allowing it to interact with the web to fetch information beyond its knowledge cutoff during agentic workflows[cite: 273, 274]. *However, the specific crawlers, collection periods, and domain names used to compile the underlying pre-training dataset are not disclosed in the source text.*
* [cite_start]**User Data:** *The document does not explicitly state whether user interaction data was utilized for training.* It does note that the model was post-trained using similar Chain-of-Thought (CoT) Reinforcement Learning techniques as OpenAI o3, giving it a personality similar to first-party products like ChatGPT[cite: 208, 209].
* **Synthetic Data:** *The provided text does not explicitly identify the names of specific models used to generate synthetic data for the training pipeline.*

---

## 3. Data Processing & Safeguard Aspects
This section outlines the specific data processing measures, safety testing, and guardrails implemented to ensure compliance and model safety.

* **Copyright Compliance (TDM Exception):** *The provided document does not outline the specific measures implemented to identify and respect opt-outs under the text and data mining (TDM) exception of EU copyright law.*
* [cite_start]**Removal of Illegal and Harmful Content (Data Filtering):** To improve model safety, the pre-training data was filtered for harmful content[cite: 142]. [cite_start]Specifically, OpenAI reused the Chemical, Biological, Radiological, and Nuclear (CBRN) pre-training filters from GPT-4o to remove hazardous biosecurity knowledge[cite: 142].
* [cite_start]**Post-Training Alignment & Safety:** The model underwent deliberative alignment to teach it to refuse unsafe prompts (e.g., illicit advice) and remain robust against jailbreaks[cite: 382]. [cite_start]The model is evaluated rigorously against standard disallowed content, including sexual content involving minors, self-harm instructions, and illicit/violent material[cite: 402, 417].
* [cite_start]**Instruction Hierarchy (Guardrail Integrity):** To prevent users from circumventing guardrails, the model is trained to adhere to a strict instruction hierarchy[cite: 435, 436]. [cite_start]Using the "harmony prompt format," the model resolves conflicts by prioritizing instructions in the system message over developer messages, and developer messages over user messages[cite: 437, 438]. 
* [cite_start]**Chain-of-Thought (CoT) Transparency:** Developers deliberately avoided putting optimization pressure on the model's Chain of Thought to prevent the model from learning to "hide its thinking" while misbehaving[cite: 459, 461]. [cite_start]Because the CoT is unrestricted, it may contain hallucinated or unfiltered content; downstream developers are advised not to expose the raw CoT directly to end-users without additional moderation[cite: 463, 464].

## 4. References
* OpenAI. (2025). *gpt-oss-120b & gpt-oss-20b Model Card*. arXiv. [https://arxiv.org/abs/2508.10925](https://arxiv.org/abs/2508.10925)

---
